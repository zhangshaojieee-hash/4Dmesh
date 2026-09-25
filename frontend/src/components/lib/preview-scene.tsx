import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export const PREVIEW_HDR_URL =
  import.meta.env.VITE_MODEL_VIEWER_HDR_URL?.trim() || '/api/models/viewer-environment';
export const PREVIEW_HDR_TIMEOUT_MS = 8000;

export const PREVIEW_MATERIAL = {
  color: '#c8c8c8',
  roughness: 0.4,
  metalness: 0.15,
  envMapIntensity: 0.8,
} as const;

export const PREVIEW_GL_PROPS = {
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance' as const,
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1,
  outputColorSpace: THREE.SRGBColorSpace,
};

export function createPreviewMaterial(color: THREE.ColorRepresentation = PREVIEW_MATERIAL.color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: PREVIEW_MATERIAL.roughness,
    metalness: PREVIEW_MATERIAL.metalness,
    envMapIntensity: PREVIEW_MATERIAL.envMapIntensity,
  });
}

export const PreviewLights: React.FC = () => (
  <>
    <ambientLight intensity={0.6} />
    <directionalLight position={[5, 8, 5]} intensity={0.8} castShadow />
    <directionalLight position={[-3, 4, -3]} intensity={0.3} />
    <pointLight position={[-3, 2, -4]} intensity={0.3} color="#FFF5E6" />
  </>
);

export const PreviewEnvironment: React.FC<{ url?: string }> = ({ url = PREVIEW_HDR_URL }) => {
  const { gl, scene } = useThree();

  useEffect(() => {
    if (!url) return;

    const pmrem = new THREE.PMREMGenerator(gl);
    const loader = new HDRLoader();
    const previousEnvironment = scene.environment;
    let disposed = false;
    let activeEnvironment: THREE.Texture | null = null;
    let timeoutId: number | undefined;

    pmrem.compileEquirectangularShader();

    const loadHdr = new Promise<THREE.DataTexture>((resolve, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error('HDR load timeout')), PREVIEW_HDR_TIMEOUT_MS);
      loader.load(url, resolve, undefined, reject);
    });

    loadHdr
      .then((hdrTexture) => {
        if (disposed) {
          hdrTexture.dispose();
          return;
        }
        activeEnvironment = pmrem.fromEquirectangular(hdrTexture).texture;
        hdrTexture.dispose();
        scene.environment = activeEnvironment;
      })
      .catch((error) => {
        if (import.meta.env.DEV && !disposed) {
          console.warn('Preview HDR environment unavailable, using local lights only.', error);
        }
      })
      .finally(() => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      });

    return () => {
      disposed = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (scene.environment === activeEnvironment) {
        scene.environment = previousEnvironment ?? null;
      }
      activeEnvironment?.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, url]);

  return null;
};
