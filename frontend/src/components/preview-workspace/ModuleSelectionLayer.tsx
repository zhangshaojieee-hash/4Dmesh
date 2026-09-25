/**
 * ModuleSelectionLayer.tsx — 模块 hover/click 选择层 (R3F 内部)
 */
import React, { useEffect, useRef, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditor, useEditorDispatch } from '../../stores/editor';
import { findCandidateByHit } from '../lib/module-detector';
import { generateId, EDITOR_COLORS } from '../lib/editor-types';
import type { Module, ModuleCandidate } from '../lib/editor-types';
import type { PreparedMesh } from '../lib/bvh-painter';
import { applyFaceColors } from '../lib/bvh-painter';
import { MAGNET_PRESETS } from '../../types';

/* ═══ Hoisted Color constants (avoid per-frame allocation) ═══ */
const COLOR_SELECTED = new THREE.Color(EDITOR_COLORS.moduleSelected);
const COLOR_HOVER = new THREE.Color(EDITOR_COLORS.moduleHover);
const COLOR_NONE = new THREE.Color(0x000000);

interface ModuleSelectionLayerProps {
  scene: THREE.Group;
  candidates: ModuleCandidate[];
  getPrepared: React.MutableRefObject<() => PreparedMesh[]>;
  notifyPaintChange?: () => void;
}

export const ModuleSelectionLayer: React.FC<ModuleSelectionLayerProps> = ({ scene, candidates, getPrepared, notifyPaintChange }) => {
  const { camera, raycaster, gl } = useThree();
  const { modules, hoveredModuleId, selectedModuleId, subMode, mode, activeStrengthIdx } = useEditor();
  const dispatch = useEditorDispatch();

  const prevHoveredRef = useRef<string | null>(null);
  const prevSelectedRef = useRef<string | null>(null);
  const prevModulesLenRef = useRef(0);

  useFrame(() => {
    if (mode !== 'edit' || subMode !== 'module') return;

    const dirty = hoveredModuleId !== prevHoveredRef.current
      || selectedModuleId !== prevSelectedRef.current
      || modules.length !== prevModulesLenRef.current;
    if (!dirty) return;
    prevHoveredRef.current = hoveredModuleId;
    prevSelectedRef.current = selectedModuleId;
    prevModulesLenRef.current = modules.length;

    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.name) return;

      const candidate = findCandidateByHit(child.name, candidates);
      if (!candidate) return;

      const savedModule = modules.find(m => m.source_segments.some(s => candidate.meshNames.includes(s)));
      const isHovered = candidate.id === hoveredModuleId;
      const isSelected = savedModule && savedModule.module_id === selectedModuleId;

      const mat = child.material as THREE.MeshStandardMaterial;
      if (isSelected) {
        mat.emissive.copy(COLOR_SELECTED);
        mat.emissiveIntensity = 0.3;
      } else if (isHovered) {
        mat.emissive.copy(COLOR_HOVER);
        mat.emissiveIntensity = 0.25;
      } else if (savedModule) {
        mat.emissive.set(savedModule.color || EDITOR_COLORS.moduleSaved);
        mat.emissiveIntensity = 0.15;
      } else {
        mat.emissive.copy(COLOR_NONE);
        mat.emissiveIntensity = 0;
      }
    });
  });

  // Pointer 事件
  const onPointerMove = useCallback((e: PointerEvent) => {
    if (mode !== 'edit' || subMode !== 'module') return;

    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(scene, true);

    if (hits.length > 0) {
      const hitMesh = hits[0].object as THREE.Mesh;
      const candidate = findCandidateByHit(hitMesh.name, candidates, hits[0].faceIndex ?? undefined);
      dispatch({ type: 'HOVER_MODULE', id: candidate?.id ?? null });
    } else {
      dispatch({ type: 'HOVER_MODULE', id: null });
    }
  }, [mode, subMode, camera, raycaster, gl, scene, candidates, dispatch]);

  const onClick = useCallback((e: MouseEvent) => {
    if (mode !== 'edit' || subMode !== 'module') return;

    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(scene, true);

    if (hits.length > 0) {
      const hitMesh = hits[0].object as THREE.Mesh;
      const candidate = findCandidateByHit(hitMesh.name, candidates, hits[0].faceIndex ?? undefined);
      if (!candidate) return;

      const existing = modules.find(m =>
        m.source_segments.some(s => candidate.meshNames.includes(s)),
      );

      if (existing) {
        dispatch({ type: 'SELECT_MODULE', id: existing.module_id });
      } else {
        const strengthId = MAGNET_PRESETS[activeStrengthIdx]?.id;

        if (strengthId && candidate.faceIndices) {
          const prepared = getPrepared.current();
          for (const p of prepared) {
            if (!candidate.meshNames.includes(p.name)) continue;
            for (const fi of candidate.faceIndices) {
              if (fi >= 0 && fi < p.faceCount) p.paintMap.set(fi, strengthId);
            }
            applyFaceColors(p);
          }
        }

        const newModule: Module = {
          module_id: generateId('mod'),
          name: candidate.name,
          source_segments: candidate.meshNames,
          visible: true,
          locked: false,
          export_enabled: true,
          tag: 'normal',
          color: EDITOR_COLORS.moduleSaved,
        };
        dispatch({ type: 'ADD_MODULE', module: newModule });
        dispatch({ type: 'SELECT_MODULE', id: newModule.module_id });
        notifyPaintChange?.();
      }
    } else {
      dispatch({ type: 'SELECT_MODULE', id: null });
    }
  }, [mode, subMode, camera, raycaster, gl, scene, candidates, modules, dispatch, activeStrengthIdx, getPrepared, notifyPaintChange]);

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('click', onClick);
    };
  }, [gl, onPointerMove, onClick]);

  return null; // 纯逻辑组件，无渲染输出
};
