/**
 * volume-shader.ts — GPU-based volume region rendering
 *
 * Custom ShaderMaterial that tests each fragment's world position against
 * up to MAX_REGIONS volume regions (box/cylinder/sphere). Fragments inside
 * a region are tinted with the region's strength color; fragments outside
 * remain the base gray color. This gives pixel-level precision with zero
 * CPU face-level computation.
 */
import * as THREE from 'three';
import type { VolumeMethod, VolumeRegion, VolumeTransform } from './editor-types';
import { volumeTransformToMatrix } from './volume-intersection';
import { MAGNET_PRESETS } from '../../types';

const MAX_REGIONS = 16;

const PENDING_COLOR = new THREE.Color('#FF8C00');

export function createVolumeShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      regionCount: { value: 0 },
      regionInverses: { value: new Array(MAX_REGIONS).fill(null).map(() => new THREE.Matrix4()) },
      regionMethods: { value: new Int32Array(MAX_REGIONS) },  // 0=box, 1=cylinder, 2=sphere
      regionColors: { value: new Array(MAX_REGIONS).fill(null).map(() => new THREE.Color(1, 0, 0)) },
      baseColor: { value: new THREE.Color(0.82, 0.82, 0.82) },
      hasPending: { value: false },
      pendingInverse: { value: new THREE.Matrix4() },
      pendingMethod: { value: 0 },
      pendingColor: { value: PENDING_COLOR.clone() },
      clipEnabled: { value: false },
      clipPlane: { value: new THREE.Vector4(0, -1, 0, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform int regionCount;
      uniform mat4 regionInverses[${MAX_REGIONS}];
      uniform int regionMethods[${MAX_REGIONS}];
      uniform vec3 regionColors[${MAX_REGIONS}];
      uniform vec3 baseColor;

      uniform bool hasPending;
      uniform mat4 pendingInverse;
      uniform int pendingMethod;
      uniform vec3 pendingColor;

      uniform bool clipEnabled;
      uniform vec4 clipPlane;

      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      bool insideUnitShape(int method, vec3 p) {
        if (method == 0) {
          // Box
          return abs(p.x) <= 0.5 && abs(p.y) <= 0.5 && abs(p.z) <= 0.5;
        } else if (method == 1) {
          // Cylinder (Y-axis)
          if (abs(p.y) > 0.5) return false;
          return (p.x * p.x + p.z * p.z) <= 0.25;
        } else {
          // Sphere
          return dot(p, p) <= 0.25;
        }
      }

      void main() {
        if (clipEnabled) {
          float d = dot(vWorldPosition, clipPlane.xyz) + clipPlane.w;
          if (d > 0.0) discard;
        }

        vec3 lightDir = normalize(vec3(5.0, 8.0, 5.0));
        float ambient = 0.4;
        float diffuse = max(dot(vWorldNormal, lightDir), 0.0) * 0.6;
        float lighting = ambient + diffuse;

        // Start with base color
        vec3 color = baseColor;

        // Test saved regions (last one wins for overlaps)
        for (int i = 0; i < ${MAX_REGIONS}; i++) {
          if (i >= regionCount) break;
          vec3 localPos = (regionInverses[i] * vec4(vWorldPosition, 1.0)).xyz;
          if (insideUnitShape(regionMethods[i], localPos)) {
            color = regionColors[i];
          }
        }

        // Test pending volume (orange overlay, wins over saved)
        if (hasPending) {
          vec3 localPos = (pendingInverse * vec4(vWorldPosition, 1.0)).xyz;
          if (insideUnitShape(pendingMethod, localPos)) {
            color = pendingColor;
          }
        }

        gl_FragColor = vec4(color * lighting, 1.0);
      }
    `,
    side: THREE.FrontSide,
    lights: false,
    clipping: true,
  });
}

const METHOD_MAP: Record<string, number> = { box: 0, cylinder: 1, sphere: 2 };

/* ── Surface shader (3D voxel texture + volume region overlay) ── */

const STRENGTH_COLORS = [
  new THREE.Color(0.82, 0.82, 0.82), // 0 = unpainted (gray)
  new THREE.Color(MAGNET_PRESETS[0]?.color ?? '#ef4444'), // 1 = strong
  new THREE.Color(MAGNET_PRESETS[1]?.color ?? '#f59e0b'), // 2 = medium
  new THREE.Color(MAGNET_PRESETS[2]?.color ?? '#3b82f6'), // 3 = weak
];

export function createSurfaceShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      paintTexture: { value: null },
      paintBBoxMin: { value: new THREE.Vector3() },
      paintBBoxInvSize: { value: new THREE.Vector3(1, 1, 1) },
      strengthColors: { value: STRENGTH_COLORS.map(c => c.clone()) },
      baseColor: { value: new THREE.Color(0.82, 0.82, 0.82) },
      hasPaintTexture: { value: false },
      // Volume region overlay (same as volume shader)
      regionCount: { value: 0 },
      regionInverses: { value: new Array(MAX_REGIONS).fill(null).map(() => new THREE.Matrix4()) },
      regionMethods: { value: new Int32Array(MAX_REGIONS) },
      regionColors: { value: new Array(MAX_REGIONS).fill(null).map(() => new THREE.Color(1, 0, 0)) },
      // Manual clipping
      clipEnabled: { value: false },
      clipPlane: { value: new THREE.Vector4(0, -1, 0, 0) },
    },
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
      out vec3 vWorldPosition;
      out vec3 vWorldNormal;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp sampler3D;

      uniform sampler3D paintTexture;
      uniform vec3 paintBBoxMin;
      uniform vec3 paintBBoxInvSize;
      uniform vec3 strengthColors[4];
      uniform vec3 baseColor;
      uniform bool hasPaintTexture;

      uniform int regionCount;
      uniform mat4 regionInverses[${MAX_REGIONS}];
      uniform int regionMethods[${MAX_REGIONS}];
      uniform vec3 regionColors[${MAX_REGIONS}];

      // Manual clipping (Three.js #include chunks don't work with GLSL3)
      uniform bool clipEnabled;
      uniform vec4 clipPlane; // (normal.xyz, constant) — discard if dot(pos,normal) > constant

      in vec3 vWorldPosition;
      in vec3 vWorldNormal;

      out vec4 fragColor;

      bool insideUnitShape(int method, vec3 p) {
        if (method == 0) {
          return abs(p.x) <= 0.5 && abs(p.y) <= 0.5 && abs(p.z) <= 0.5;
        } else if (method == 1) {
          if (abs(p.y) > 0.5) return false;
          return (p.x * p.x + p.z * p.z) <= 0.25;
        } else {
          return dot(p, p) <= 0.25;
        }
      }

      void main() {
        // Clipping plane test
        if (clipEnabled) {
          float d = dot(vWorldPosition, clipPlane.xyz) + clipPlane.w;
          if (d > 0.0) discard;
        }

        vec3 lightDir = normalize(vec3(5.0, 8.0, 5.0));
        float ambient = 0.4;
        float diffuse = max(dot(vWorldNormal, lightDir), 0.0) * 0.6;
        float lighting = ambient + diffuse;

        vec3 color = baseColor;

        // Sample 3D paint texture
        if (hasPaintTexture) {
          vec3 uvw = (vWorldPosition - paintBBoxMin) * paintBBoxInvSize;
          if (all(greaterThanEqual(uvw, vec3(0.0))) && all(lessThanEqual(uvw, vec3(1.0)))) {
            float val = texture(paintTexture, uvw).r * 255.0;
            int idx = int(val + 0.5);
            if (idx > 0 && idx <= 3) {
              color = strengthColors[idx];
            }
          }
        }

        // Volume regions overlay (wins over paint)
        for (int i = 0; i < ${MAX_REGIONS}; i++) {
          if (i >= regionCount) break;
          vec3 localPos = (regionInverses[i] * vec4(vWorldPosition, 1.0)).xyz;
          if (insideUnitShape(regionMethods[i], localPos)) {
            color = regionColors[i];
          }
        }

        fragColor = vec4(color * lighting, 1.0);
      }
    `,
    side: THREE.FrontSide,
    lights: false,
    clipping: true,
  });
}

export function updateSurfaceShaderUniforms(
  material: THREE.ShaderMaterial,
  paintBBox: THREE.Box3 | null,
  paintTexture: THREE.Data3DTexture | null,
  volumeRegions: VolumeRegion[],
): void {
  if (paintBBox && paintTexture) {
    material.uniforms.hasPaintTexture.value = true;
    material.uniforms.paintTexture.value = paintTexture;
    material.uniforms.paintBBoxMin.value.copy(paintBBox.min);
    // VoxelGrid uses uniform voxelSize = maxDim / resolution, so the
    // occupied 3D-texture space is a cube of side maxDim, NOT bbox.size.
    const size = new THREE.Vector3();
    paintBBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const inv = maxDim > 0 ? 1 / maxDim : 0;
    material.uniforms.paintBBoxInvSize.value.set(inv, inv, inv);
  } else {
    material.uniforms.hasPaintTexture.value = false;
  }

  const magnetic = volumeRegions.filter(r => r.tag === 'magnetic' && r.strengthId);
  const count = Math.min(magnetic.length, MAX_REGIONS);
  material.uniforms.regionCount.value = count;

  for (let i = 0; i < count; i++) {
    const region = magnetic[i];
    const mat = volumeTransformToMatrix(region.transform);
    material.uniforms.regionInverses.value[i].copy(mat).invert();
    material.uniforms.regionMethods.value[i] = METHOD_MAP[region.method] ?? 0;
    const preset = MAGNET_PRESETS.find(p => p.id === region.strengthId);
    if (preset) material.uniforms.regionColors.value[i].set(preset.color);
  }
}

export function updateVolumeShaderUniforms(
  material: THREE.ShaderMaterial,
  volumeRegions: VolumeRegion[],
  pendingVolume?: { method: VolumeMethod; transform: VolumeTransform } | null,
): void {
  const magnetic = volumeRegions.filter(r => r.tag === 'magnetic' && r.strengthId);
  const count = Math.min(magnetic.length, MAX_REGIONS);

  material.uniforms.regionCount.value = count;

  for (let i = 0; i < count; i++) {
    const region = magnetic[i];
    const mat = volumeTransformToMatrix(region.transform);
    material.uniforms.regionInverses.value[i].copy(mat).invert();
    material.uniforms.regionMethods.value[i] = METHOD_MAP[region.method] ?? 0;

    const preset = MAGNET_PRESETS.find(p => p.id === region.strengthId);
    if (preset) {
      material.uniforms.regionColors.value[i].set(preset.color);
    }
  }

  if (pendingVolume) {
    material.uniforms.hasPending.value = true;
    const mat = volumeTransformToMatrix(pendingVolume.transform);
    material.uniforms.pendingInverse.value.copy(mat).invert();
    material.uniforms.pendingMethod.value = METHOD_MAP[pendingVolume.method] ?? 0;
  } else {
    material.uniforms.hasPending.value = false;
  }
}
