import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { flatten3MFGroup } from '../components/lib/flatten-3mf';
import { getFileExtension } from './path';

export interface GeneratedModelThumbnail {
  file: File;
  previewUrl: string;
  generatedFromModel: boolean;
}

const THUMB_WIDTH = 640;
const THUMB_HEIGHT = 480;

const disposeObject = (root: THREE.Object3D) => {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      material.dispose();
    }
  });
};

const fileToArrayBuffer = (file: File): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('Unexpected file reader result'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file'));
    reader.readAsArrayBuffer(file);
  });

const loadModelObject = async (file: File): Promise<THREE.Object3D> => {
  const ext = getFileExtension(file.name);
  const buffer = await fileToArrayBuffer(file);

  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(buffer, '');
    return gltf.scene;
  }

  if (ext === 'obj') {
    const text = new TextDecoder().decode(buffer);
    return new OBJLoader().parse(text);
  }

  if (ext === 'stl') {
    const geometry = new STLLoader().parse(buffer);
    geometry.computeVertexNormals();
    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: '#dbe8f4', roughness: 0.62, metalness: 0.04 }),
    );
  }

  if (ext === '3mf') {
    const group = new ThreeMFLoader().parse(buffer);
    return flatten3MFGroup(group);
  }

  throw new Error(`Unsupported thumbnail model format: ${ext}`);
};

const objectToThumbnailBlob = async (object: THREE.Object3D): Promise<Blob> => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f4f8fb');

  const root = new THREE.Group();
  root.add(object);
  scene.add(root);

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  root.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const camera = new THREE.PerspectiveCamera(38, THUMB_WIDTH / THUMB_HEIGHT, 0.01, maxDim * 20);
  camera.position.set(0, maxDim * 0.14, maxDim * 2.85);
  camera.lookAt(0, 0, 0);

  const hemiLight = new THREE.HemisphereLight('#ffffff', '#9fb3c8', 2.1);
  scene.add(hemiLight);
  const keyLight = new THREE.DirectionalLight('#ffffff', 2.8);
  keyLight.position.set(2.2, 3.2, 4.8);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight('#b8e8ff', 1.2);
  rimLight.position.set(-3, 2, 2);
  scene.add(rimLight);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(maxDim * 0.74, 48),
    new THREE.MeshBasicMaterial({ color: '#e4eef6', transparent: true, opacity: 0.76 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -size.y / 2 - maxDim * 0.03;
  scene.add(ground);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(THUMB_WIDTH, THUMB_HEIGHT);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.render(scene, camera);

  const blob = await new Promise<Blob>((resolve, reject) => {
    renderer.domElement.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error('Unable to encode model thumbnail'));
    }, 'image/png', 0.92);
  });

  renderer.dispose();
  disposeObject(root);
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  return blob;
};

const createFallbackBlob = async (file: File): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');

  const ext = getFileExtension(file.name).toUpperCase() || '3D';
  const gradient = ctx.createLinearGradient(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  gradient.addColorStop(0, '#f8fbff');
  gradient.addColorStop(0.58, '#e7f3fb');
  gradient.addColorStop(1, '#f6ead0');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

  ctx.fillStyle = 'rgba(47, 142, 216, 0.12)';
  ctx.beginPath();
  ctx.ellipse(THUMB_WIDTH / 2, 320, 170, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(THUMB_WIDTH / 2, 226);
  ctx.strokeStyle = '#2f8ed8';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -92);
  ctx.lineTo(94, -38);
  ctx.lineTo(94, 70);
  ctx.lineTo(0, 122);
  ctx.lineTo(-94, 70);
  ctx.lineTo(-94, -38);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-94, -38);
  ctx.lineTo(0, 18);
  ctx.lineTo(94, -38);
  ctx.moveTo(0, 18);
  ctx.lineTo(0, 122);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#17304e';
  ctx.font = '700 52px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(ext, THUMB_WIDTH / 2, 420);

  ctx.fillStyle = '#607690';
  ctx.font = '500 22px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('正面预览将在上传后由服务端补齐', THUMB_WIDTH / 2, 454);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Unable to encode fallback thumbnail'));
    }, 'image/png', 0.92);
  });
};

export const generateModelThumbnail = async (file: File): Promise<GeneratedModelThumbnail> => {
  let blob: Blob;
  let generatedFromModel = true;
  try {
    const object = await loadModelObject(file);
    blob = await objectToThumbnailBlob(object);
  } catch {
    generatedFromModel = false;
    blob = await createFallbackBlob(file);
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'model';
  const thumbnailFile = new File([blob], `${baseName}-front-preview.png`, { type: 'image/png' });
  return {
    file: thumbnailFile,
    previewUrl: URL.createObjectURL(thumbnailFile),
    generatedFromModel,
  };
};
