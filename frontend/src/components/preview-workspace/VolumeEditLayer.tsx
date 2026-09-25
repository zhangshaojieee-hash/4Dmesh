/**
 * VolumeEditLayer.tsx — 体积区域编辑层 (R3F 内部)
 *
 * Volume 模式使用 GPU shader 渲染区域边界（像素级精度），
 * 不做任何 CPU 面级计算。区域数据只存储空间定义。
 */
import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditor, useEditorDispatch } from '../../stores/editor';
import { createVolumeGeometry, volumeTransformToMatrix } from '../lib/volume-intersection';
import { createVolumeShaderMaterial, updateVolumeShaderUniforms } from '../lib/volume-shader';
import type { VolumeRegion, VolumeTransform } from '../lib/editor-types';
import { MAGNET_PRESETS, DEFAULT_DIRECTION } from '../../types';
import { TransformControls, type OrbitControlsLike, type TransformControlsLike } from '../preview-common/ThreeControls';

type TransformControlsEvent = { value: boolean };
type VolumeTransformControlsLike = TransformControlsLike & {
  addEventListener: (type: 'dragging-changed', handler: (event: TransformControlsEvent) => void) => void;
  removeEventListener: (type: 'dragging-changed', handler: (event: TransformControlsEvent) => void) => void;
};
type EditorAction = Parameters<ReturnType<typeof useEditorDispatch>>[0];

/* ═══ Constants ═══ */

const WIREFRAME_COLOR_PENDING = '#EF4444';
const WIREFRAME_COLOR_SELECTED = '#EF4444';
const WIREFRAME_OPACITY_PENDING = 0.6;
const WIREFRAME_OPACITY_SAVED = 0.25;
const WIREFRAME_OPACITY_SELECTED = 0.5;
const VOLUME_FILL_OPACITY = 0.12;
const PENDING_FILL_COLOR = '#FF8C00';
const PENDING_FILL_OPACITY = 0.18;

/** Extract only real model meshes from scene (skip helpers like brush indicator, wireframes) */
function getModelMeshes(scene: THREE.Group): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((child) => {
    const material = child instanceof THREE.Mesh ? child.material : null;
    const materialVisible = Array.isArray(material)
      ? material.some((item) => item.visible !== false)
      : material?.visible !== false;
    if (child instanceof THREE.Mesh && child.geometry && child.visible && materialVisible) {
      // Skip wireframe helpers and invisible hit targets
      if (child.geometry.type === 'RingGeometry' || child.geometry.type === 'WireframeGeometry') return;
      meshes.push(child);
    }
  });
  return meshes;
}

interface VolumeEditLayerProps {
  scene: THREE.Group;
  orbitRef: React.MutableRefObject<OrbitControlsLike | null>;
}

/* ═══ 已保存 Volume Gizmo (线框) ═══ */

const SavedVolumeGizmo: React.FC<{
  region: VolumeRegion;
  isSelected: boolean;
  onClick: () => void;
  orbitRef: React.MutableRefObject<OrbitControlsLike | null>;
  gizmoMode: 'translate' | 'rotate' | 'scale';
  dispatch: React.Dispatch<EditorAction>;
}> = ({ region, isSelected, onClick, orbitRef, gizmoMode, dispatch }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const tcRef = useRef<VolumeTransformControlsLike | null>(null);
  const [controlObject, setControlObject] = React.useState<THREE.Mesh | null>(null);
  const geo = useMemo(() => createVolumeGeometry(region.method), [region.method]);
  const wireGeo = useMemo(() => new THREE.WireframeGeometry(geo), [geo]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strengthColor = MAGNET_PRESETS.find(p => p.id === region.strengthId)?.color ?? '#4FC3F7';
  const setMeshNode = useCallback((node: THREE.Mesh | null) => {
    meshRef.current = node;
    setControlObject(node);
  }, []);

  useEffect(() => {
    if (!meshRef.current) return;
    const mat = volumeTransformToMatrix(region.transform);
    meshRef.current.position.setFromMatrixPosition(mat);
    meshRef.current.rotation.setFromRotationMatrix(mat);
    meshRef.current.scale.setFromMatrixScale(mat);
  }, [region.transform]);

  // TransformControls orbit 联动
  useEffect(() => {
    const tc = tcRef.current;
    if (!tc || !orbitRef.current) return;
    const handler = (e: TransformControlsEvent) => {
      if (orbitRef.current) orbitRef.current.enabled = !e.value;
    };
    tc.addEventListener('dragging-changed', handler);
    return () => tc.removeEventListener('dragging-changed', handler);
  }, [orbitRef, isSelected]);

  // 拖拽结束同步到 store
  const onObjectChange = useCallback(() => {
    if (!meshRef.current) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const m = meshRef.current!;
      const transform: VolumeTransform = {
        position: [m.position.x, m.position.y, m.position.z],
        rotation: [
          THREE.MathUtils.radToDeg(m.rotation.x),
          THREE.MathUtils.radToDeg(m.rotation.y),
          THREE.MathUtils.radToDeg(m.rotation.z),
        ],
        scale: [m.scale.x, m.scale.y, m.scale.z],
      };
      dispatch({ type: 'UPDATE_VOLUME', id: region.region_id, changes: { transform } });
    }, 50);
  }, [dispatch, region.region_id]);

  return (
    <>
      <mesh
        ref={setMeshNode}
        geometry={geo}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        <meshBasicMaterial
          color={strengthColor}
          transparent
          opacity={isSelected ? WIREFRAME_OPACITY_SELECTED * 0.4 : VOLUME_FILL_OPACITY}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
        <lineSegments geometry={wireGeo} raycast={() => null}>
          <lineBasicMaterial
            color={isSelected ? WIREFRAME_COLOR_SELECTED : strengthColor}
            transparent
            opacity={isSelected ? WIREFRAME_OPACITY_SELECTED : WIREFRAME_OPACITY_SAVED}
            depthTest
          />
        </lineSegments>
      </mesh>
      {region.tag === 'magnetic' && (() => {
        const dir = region.direction ?? (DEFAULT_DIRECTION as [number, number, number]);
        const dirVec = new THREE.Vector3(...dir).normalize();
        const arrowLen = Math.max(region.transform.scale[0], region.transform.scale[1], region.transform.scale[2]) * 0.8;
        return (
          <arrowHelper
            args={[dirVec, new THREE.Vector3(0, 0, 0), arrowLen, strengthColor, arrowLen * 0.25, arrowLen * 0.12]}
            position={[region.transform.position[0], region.transform.position[1], region.transform.position[2]]}
          />
        );
      })()}
      {isSelected && controlObject && (
        <TransformControls
          ref={tcRef as React.MutableRefObject<VolumeTransformControlsLike | null>}
          object={controlObject}
          mode={gizmoMode}
          onObjectChange={onObjectChange}
        />
      )}
    </>
  );
};

/* ═══ 主组件 ═══ */

export const VolumeEditLayer: React.FC<VolumeEditLayerProps> = ({ scene, orbitRef }) => {
  const { camera, raycaster, gl } = useThree();
  const {
    mode, subMode, pendingVolume, volumeRegions, selectedVolumeId,
    activeVolumeMethod, volumeGizmoMode, modelExtent, volumeSizeNorm, activeStrengthIdx, volumeHandMode,
  } = useEditor();
  const dispatch = useEditorDispatch();

  const pendingMeshRef = useRef<THREE.Mesh>(null);
  const transformRef = useRef<VolumeTransformControlsLike | null>(null);
  const [pendingControlObject, setPendingControlObject] = useState<THREE.Mesh | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ghostRef = useRef<THREE.Group>(null);
  const _ghostMouse = useRef(new THREE.Vector2());
  const ghostSize = modelExtent * volumeSizeNorm;
  const ghostGeo = useMemo(() => createVolumeGeometry(activeVolumeMethod), [activeVolumeMethod]);
  const ghostWireGeo = useMemo(() => new THREE.WireframeGeometry(ghostGeo), [ghostGeo]);
  const pendingMethod = pendingVolume?.method ?? null;
  const pendingGeo = useMemo(() => pendingMethod ? createVolumeGeometry(pendingMethod) : null, [pendingMethod]);
  const pendingWireGeo = useMemo(() => pendingGeo ? new THREE.WireframeGeometry(pendingGeo) : null, [pendingGeo]);
  const setPendingMeshNode = useCallback((node: THREE.Mesh | null) => {
    pendingMeshRef.current = node;
    setPendingControlObject(node);
  }, []);

  const shaderMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const savedMaterialsRef = useRef<Map<THREE.Mesh, THREE.Material>>(new Map());

  useEffect(() => {
    const meshes = getModelMeshes(scene);
    if (meshes.length === 0) return;

    const shaderMat = createVolumeShaderMaterial();
    shaderMaterialRef.current = shaderMat;

    const saved = new Map<THREE.Mesh, THREE.Material>();
    for (const mesh of meshes) {
      saved.set(mesh, mesh.material as THREE.Material);
      mesh.material = shaderMat;
    }
    savedMaterialsRef.current = saved;

    updateVolumeShaderUniforms(shaderMat, volumeRegions, pendingVolume);

    return () => {
      for (const [mesh, origMat] of saved) {
        if (mesh.material === shaderMat) {
          mesh.material = origMat;
        }
      }
      shaderMat.dispose();
      shaderMaterialRef.current = null;
      savedMaterialsRef.current.clear();
    };
  }, [pendingVolume, scene, volumeRegions]);

  useEffect(() => {
    if (!shaderMaterialRef.current) return;
    updateVolumeShaderUniforms(shaderMaterialRef.current, volumeRegions, pendingVolume);
  }, [volumeRegions, pendingVolume]);

  useEffect(() => {
    if (!pendingMeshRef.current || !pendingVolume) return;
    const { position, rotation, scale } = pendingVolume.transform;
    pendingMeshRef.current.position.set(...position);
    pendingMeshRef.current.rotation.set(
      THREE.MathUtils.degToRad(rotation[0]),
      THREE.MathUtils.degToRad(rotation[1]),
      THREE.MathUtils.degToRad(rotation[2]),
    );
    pendingMeshRef.current.scale.set(...scale);
  }, [pendingVolume]);

  useEffect(() => {
    const tc = transformRef.current;
    if (!tc || !orbitRef.current) return;
    const handler = (e: TransformControlsEvent) => {
      if (orbitRef.current) orbitRef.current.enabled = !e.value;
    };
    tc.addEventListener('dragging-changed', handler);
    return () => tc.removeEventListener('dragging-changed', handler);
  }, [orbitRef, pendingVolume]);

  const onTransformChange = useCallback(() => {
    if (!pendingMeshRef.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const m = pendingMeshRef.current!;
      const transform: VolumeTransform = {
        position: [m.position.x, m.position.y, m.position.z],
        rotation: [
          THREE.MathUtils.radToDeg(m.rotation.x),
          THREE.MathUtils.radToDeg(m.rotation.y),
          THREE.MathUtils.radToDeg(m.rotation.z),
        ],
        scale: [m.scale.x, m.scale.y, m.scale.z],
      };
      dispatch({ type: 'UPDATE_PENDING_VOLUME', transform });
    }, 50);
  }, [dispatch]);

  const onClick = useCallback((e: MouseEvent) => {
    if (mode !== 'edit' || subMode !== 'volume' || pendingVolume || volumeHandMode) return;

    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);
    const modelMeshes = getModelMeshes(scene);
    const hits = raycaster.intersectObjects(modelMeshes, false);

    if (hits.length > 0) {
      const hit = hits[0];
      const pos = hit.point;
      const initScale = modelExtent * volumeSizeNorm;

      const transform: VolumeTransform = {
        position: [pos.x, pos.y, pos.z],
        rotation: [0, 0, 0],
        scale: [initScale, initScale, initScale],
      };

      dispatch({ type: 'START_PENDING_VOLUME', method: activeVolumeMethod, transform });
    }
  }, [mode, subMode, pendingVolume, volumeHandMode, camera, raycaster, gl, scene, modelExtent, activeVolumeMethod, volumeSizeNorm, dispatch]);

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [gl, onClick]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (mode !== 'edit' || subMode !== 'volume' || pendingVolume || volumeHandMode) {
      if (ghostRef.current) ghostRef.current.visible = false;
      return;
    }
    const rect = gl.domElement.getBoundingClientRect();
    _ghostMouse.current.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(_ghostMouse.current, camera);
    const modelMeshes = getModelMeshes(scene);
    const hits = raycaster.intersectObjects(modelMeshes, false);
    if (hits.length > 0 && ghostRef.current) {
      ghostRef.current.position.copy(hits[0].point);
      ghostRef.current.visible = true;
    } else if (ghostRef.current) {
      ghostRef.current.visible = false;
    }
  }, [mode, subMode, pendingVolume, volumeHandMode, camera, raycaster, gl, scene]);

  const onPointerLeave = useCallback(() => {
    if (ghostRef.current) ghostRef.current.visible = false;
  }, []);

  const onWheel = useCallback((e: WheelEvent) => {
    if (mode !== 'edit' || subMode !== 'volume') return;
    if (!e.shiftKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.02 : 0.02;
    dispatch({ type: 'SET_VOLUME_SIZE_NORM', norm: volumeSizeNorm + delta });
  }, [mode, subMode, volumeSizeNorm, dispatch]);

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('wheel', onWheel);
    };
  }, [gl, onPointerMove, onPointerLeave, onWheel]);

  const onSelectSaved = useCallback((id: string) => {
    dispatch({ type: 'SELECT_VOLUME', id });
  }, [dispatch]);

  if (mode !== 'edit' || subMode !== 'volume') return null;

  const activeStrengthColor = MAGNET_PRESETS[activeStrengthIdx]?.color ?? '#4FC3F7';

  return (
    <>
      <group ref={ghostRef} visible={false} scale={[ghostSize, ghostSize, ghostSize]}>
        <lineSegments geometry={ghostWireGeo}>
          <lineBasicMaterial color={activeStrengthColor} transparent opacity={0.25} depthTest />
        </lineSegments>
      </group>

      {volumeRegions.map(region => (
        <SavedVolumeGizmo
          key={region.region_id}
          region={region}
          isSelected={region.region_id === selectedVolumeId}
          onClick={() => onSelectSaved(region.region_id)}
          orbitRef={orbitRef}
          gizmoMode={volumeGizmoMode}
          dispatch={dispatch}
        />
      ))}

      {pendingVolume && pendingGeo && (
        <>
          <mesh ref={setPendingMeshNode} geometry={pendingGeo}>
            <meshBasicMaterial
              color={PENDING_FILL_COLOR}
              transparent
              opacity={PENDING_FILL_OPACITY}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
            {pendingWireGeo && (
              <lineSegments geometry={pendingWireGeo} raycast={() => null}>
                <lineBasicMaterial
                  color={WIREFRAME_COLOR_PENDING}
                  transparent
                  opacity={WIREFRAME_OPACITY_PENDING}
                  depthTest
                />
              </lineSegments>
            )}
          </mesh>
          {pendingControlObject && (
            <TransformControls
              ref={transformRef as React.MutableRefObject<VolumeTransformControlsLike | null>}
              object={pendingControlObject}
              mode={volumeGizmoMode}
              onObjectChange={onTransformChange}
            />
          )}
        </>
      )}
    </>
  );
};
