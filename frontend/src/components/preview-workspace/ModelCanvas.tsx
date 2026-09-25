/**
 * ModelCanvas.tsx — R3F Canvas 容器
 *
 * 负责加载 3MF/STL/OBJ、设置灯光/相机/OrbitControls，
 * 根据 subMode 条件渲染对应的交互层。
 */
import React, { useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { flatten3MFGroup } from '../lib/flatten-3mf';
import { useEditor, useEditorDispatch } from '../../stores/editor';
import PreviewViewportControls from '../preview-common/PreviewViewportControls';
import { createPreviewMaterial, PreviewEnvironment, PreviewLights, PREVIEW_GL_PROPS } from '../lib/preview-scene';
import { ContactShadows, Grid, OrbitControls, type OrbitControlsLike } from '../preview-common/ThreeControls';

function disposeMaterial(material: THREE.Material) {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry?.dispose();
    const material = child.material;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

/* ═══ 多格式模型加载 Hook ═══ */

function useModelLoader(url: string | undefined) {
  const [scene, setScene] = React.useState<THREE.Group | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const sceneRef = React.useRef<THREE.Group | null>(null);

  useEffect(() => {
    return () => {
      if (sceneRef.current) {
        disposeObject3D(sceneRef.current);
        sceneRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!url) {
      if (sceneRef.current) {
        disposeObject3D(sceneRef.current);
        sceneRef.current = null;
      }
      setScene(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setScene(null);
    if (sceneRef.current) {
      disposeObject3D(sceneRef.current);
      sceneRef.current = null;
    }

    const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();

    const handleLoadedGroup = (group: THREE.Group) => {
      if (cancelled) {
        disposeObject3D(group);
        return;
      }
      sceneRef.current = group;
      setScene(group);
      setLoading(false);
    };

    const handleError = (msg: string) => {
      if (cancelled) return;
      setScene(null);
      setLoadError(msg);
      setLoading(false);
    };

    if (ext === 'stl') {
      const loader = new STLLoader();
      loader.load(
        url,
        (geometry) => {
          const material = createPreviewMaterial();
          const mesh = new THREE.Mesh(geometry, material);
          const group = new THREE.Group();
          group.add(mesh);
          handleLoadedGroup(group);
        },
        undefined,
        () => handleError('STL 模型加载失败'),
      );
    } else if (ext === 'obj') {
      const loader = new OBJLoader();
      loader.load(
        url,
        (obj) => handleLoadedGroup(obj),
        undefined,
        () => handleError('OBJ 模型加载失败'),
      );
    } else if (ext === '3mf') {
      const loader = new ThreeMFLoader();
      loader.load(
        url,
        (obj) => handleLoadedGroup(flatten3MFGroup(obj)),
        undefined,
        () => handleError('3MF 模型加载失败'),
      );
    } else if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => handleLoadedGroup(gltf.scene),
        undefined,
        () => handleError('GLB/GLTF 模型加载失败'),
      );
    } else {
      handleError(`当前预览器不支持该模型格式: ${ext ?? 'unknown'}`);
    }

    return () => {
      cancelled = true;
      THREE.Cache.remove(url);
    };
  }, [url]);

  return { scene, loading, loadError };
}

/* ═══ 场景内容 ═══ */

interface SceneContentProps {
  scene: THREE.Group;
  orbitRef: React.MutableRefObject<OrbitControlsLike | null>;
  ctrlPressed?: boolean;
  children?: React.ReactNode;
}

type ClipShadowMaterial = THREE.Material & { clipShadows?: boolean };

const SceneContent: React.FC<SceneContentProps> = ({ scene, orbitRef, ctrlPressed, children }) => {
  const { viewMode, xray, sectionEnabled, sectionHeight, subMode, volumeHandMode } = useEditor();
  const dispatch = useEditorDispatch();
  const { gl, camera } = useThree();

  // 自动居中 + 计算模型边界 + 相机自动适配
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    scene.position.set(-center.x, -center.y, -center.z);
    scene.updateMatrixWorld(true);

    const centeredBox = new THREE.Box3().setFromObject(scene);
    const size = centeredBox.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 0.01);
    dispatch({ type: 'SET_MODEL_BOUNDS', min: centeredBox.min.y, max: centeredBox.max.y, extent });

    // 根据模型包围球自动调整相机距离
    const sphere = centeredBox.getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius || 1;
    const perspCam = camera as THREE.PerspectiveCamera;
    const fovRad = (perspCam.fov * Math.PI) / 180;
    const dist = radius / Math.sin(fovRad / 2) * 1.2;
    perspCam.position.set(dist * 0.6, dist * 0.5, dist * 0.6);
    perspCam.near = Math.max(0.001, dist * 0.01);
    perspCam.far = Math.max(1000, dist * 20);
    perspCam.updateProjectionMatrix();
    perspCam.lookAt(0, 0, 0);

    if (orbitRef.current) {
      orbitRef.current.target.set(0, 0, 0);
      orbitRef.current.minDistance = radius * 0.1;
      orbitRef.current.maxDistance = dist * 5;
      orbitRef.current.update();
    }
  }, [scene, dispatch, camera, orbitRef]);

  // 视图模式
  useEffect(() => {
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of materials) {
          if ('wireframe' in mat) mat.wireframe = viewMode === 'wireframe';
          mat.transparent = viewMode === 'transparent' || xray;
          mat.opacity = viewMode === 'transparent' ? 0.5 : xray ? 0.85 : 1.0;
          mat.depthWrite = viewMode !== 'transparent';
          mat.side = xray ? THREE.DoubleSide : THREE.FrontSide;
          if (mat instanceof THREE.MeshStandardMaterial) {
            if (subMode === 'volume' && !mat.vertexColors) {
              mat.color.set('#E0E0E0');
              mat.roughness = 0.8;
              mat.metalness = 0;
            }
          }
          mat.needsUpdate = true;
        }
      }
    });
  }, [scene, viewMode, xray, subMode]);

  // 剖切平面
  const clipPlane = useRef(new THREE.Plane(new THREE.Vector3(0, -1, 0), 0));

  useEffect(() => {
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mat = child.material;
      if (mat instanceof THREE.ShaderMaterial && mat.uniforms.clipEnabled) {
        mat.uniforms.clipEnabled.value = sectionEnabled;
        if (sectionEnabled) {
          mat.uniforms.clipPlane.value.set(0, 1, 0, -sectionHeight);
        }
        mat.needsUpdate = true;
      } else {
        const m = mat as THREE.Material;
        if (sectionEnabled) {
          clipPlane.current.constant = sectionHeight;
          m.clippingPlanes = [clipPlane.current];
          (m as ClipShadowMaterial).clipShadows = true;
        } else {
          m.clippingPlanes = [];
        }
      }
    });
    gl.localClippingEnabled = sectionEnabled;
  }, [sectionEnabled, sectionHeight, scene, gl]);

  return (
    <>
      <PreviewLights />

      <Grid args={[20, 20]} cellColor="#D1D5DB" sectionColor="#94A3B8" fadeDistance={40} fadeStrength={1} position={[0, -2, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.01, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#E8ECF0" roughness={0.95} metalness={0.0} />
      </mesh>

      <PreviewEnvironment />
      <ContactShadows position={[0, -2, 0]} opacity={0.4} scale={10} blur={2} far={4} />

      <OrbitControls
        ref={orbitRef}
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={0.01}
        maxDistance={500}
        enableRotate={subMode !== 'volume' || volumeHandMode || ctrlPressed || false}
        enablePan={subMode !== 'volume' || volumeHandMode || ctrlPressed || false}
      />

      <primitive object={scene} />

      {children}
    </>
  );
};

/* ═══ 主组件 ═══ */

export interface ModelCanvasProps {
  scene: THREE.Group | null;
  loading?: boolean;
  loadError?: string | null;
  orbitRef: React.MutableRefObject<OrbitControlsLike | null>;
  ctrlPressed?: boolean;
  children?: React.ReactNode;
}

export const ModelCanvas: React.FC<ModelCanvasProps> = ({ scene, loading, loadError, orbitRef, ctrlPressed, children }) => {
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);

  const setView = (position: [number, number, number]) => {
    if (!cameraRef.current) return;
    cameraRef.current.position.set(...position);
    cameraRef.current.lookAt(0, 0, 0);
    orbitRef.current?.target.set(0, 0, 0);
    orbitRef.current?.update();
  };

  return (
    <div style={canvasContainerStyle}>
      <PreviewViewportControls
        onTop={() => setView([0, 8, 0.01])}
        onFront={() => setView([0, 0, 8])}
        onSide={() => setView([8, 0, 0])}
        onPerspective={() => setView([3, 3, 3])}
        onReset={() => setView([3, 3, 3])}
      />
      {loading && (
        <div style={loadingStyle}>
          <div style={spinnerStyle} />
          <span style={{ marginTop: 10, fontSize: '0.82rem', color: 'var(--text-tertiary, #9CA3AF)', fontWeight: 500 }}>加载模型中…</span>
        </div>
      )}
      {!loading && loadError && (
        <div style={errorStyle}>
          <div style={{ fontWeight: 700, color: 'var(--error, #EF4444)', marginBottom: 6 }}>模型加载失败</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary, #6B7280)' }}>{loadError}</div>
        </div>
      )}
      <Canvas
        camera={{ position: [3, 3, 3], fov: 45, near: 0.01, far: 1000 }}
        style={{ width: '100%', height: '100%' }}
        shadows
        dpr={[1, 1.5]}
        gl={PREVIEW_GL_PROPS}
        onCreated={({ camera }) => {
          cameraRef.current = camera as THREE.PerspectiveCamera;
        }}
      >
        {scene && (
          <SceneContent scene={scene} orbitRef={orbitRef} ctrlPressed={ctrlPressed}>
            {children}
          </SceneContent>
        )}
      </Canvas>
    </div>
  );
};

/* ═══ 导出 scene 的 hook（供外部获取当前 scene） ═══ */

export { useModelLoader };

const canvasContainerStyle: React.CSSProperties = {
  flex: 1, position: 'relative', minHeight: 0,
  background: 'linear-gradient(180deg, #F8F9FB 0%, #EBEEF2 100%)',
  borderRadius: 0,
};

const loadingStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(248,249,251,0.85)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  zIndex: 10,
};

const spinnerStyle: React.CSSProperties = {
  width: 32, height: 32,
  border: '3px solid var(--border-light, #E8EBED)',
  borderTopColor: 'var(--primary, #FF8C42)',
  borderRadius: '50%',
  animation: 'spin 0.7s linear infinite',
};

const errorStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: 24,
  background: 'rgba(248,249,251,0.92)',
};
