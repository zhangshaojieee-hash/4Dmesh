import React, { useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { flatten3MFGroup } from './lib/flatten-3mf';
import { createPreviewMaterial, PreviewEnvironment, PreviewLights, PREVIEW_GL_PROPS } from './lib/preview-scene';
import { ContactShadows, OrbitControls, PerspectiveCamera } from './preview-common/ThreeControls';

interface ModelViewerProps {
  url: string;
}

/** Dispose all geometries, materials, textures in a scene */
function disposeScene(scene: THREE.Object3D) {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat) => {
        if (mat) {
          Object.values(mat).forEach((val) => {
            if (val instanceof THREE.Texture) val.dispose();
          });
          mat.dispose();
        }
      });
    }
  });
}

/** The actual Three.js model component */
const LoadedModel: React.FC<{ scene: THREE.Group }> = ({ scene }) => {
  const ref = useRef<THREE.Group>(null);

  useEffect(() => {
    if (ref.current) {
      // Center the model
      const box = new THREE.Box3().setFromObject(scene);
      const center = box.getCenter(new THREE.Vector3());
      scene.position.sub(center);
    }
  }, [scene]);

  return <primitive ref={ref} object={scene} />;
};

const ModelViewer: React.FC<ModelViewerProps> = ({ url }) => {
  const [modelScene, setModelScene] = useState<THREE.Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState('');
  const prevSceneRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    setLoadProgress(0);

    // Detect file format from URL
    const ext = url.toLowerCase().split('.').pop()?.split('?')[0];
    
    const onSuccess = (result: THREE.Group | THREE.Object3D) => {
      if (prevSceneRef.current) {
        disposeScene(prevSceneRef.current);
      }
      
      // Ensure result is a Group
      let group: THREE.Group;
      if (result instanceof THREE.Group) {
        group = result;
      } else {
        group = new THREE.Group();
        group.add(result);
      }
      
      // Flatten 3MF groups if needed
      const flat = ext === '3mf' ? flatten3MFGroup(group) : group;
      
      prevSceneRef.current = flat;
      setModelScene(flat);
      setLoading(false);
      setLoadProgress(100);
    };

    const onProgress = (progress: ProgressEvent) => {
      if (progress.total > 0) {
        setLoadProgress(Math.round((progress.loaded / progress.total) * 100));
      }
    };

    const onError = () => {
      setError('无法加载模型文件');
      setLoading(false);
    };

    // Load based on file extension
    if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => onSuccess(gltf.scene),
        onProgress,
        onError
      );
    } else if (ext === 'obj') {
      const loader = new OBJLoader();
      loader.load(url, onSuccess, onProgress, onError);
    } else if (ext === 'stl') {
      const loader = new STLLoader();
      loader.load(
        url,
        (geometry) => {
          const material = createPreviewMaterial();
          const mesh = new THREE.Mesh(geometry, material);
          onSuccess(mesh);
        },
        onProgress,
        onError
      );
    } else if (ext === '3mf') {
      const loader = new ThreeMFLoader();
      loader.load(url, onSuccess, onProgress, onError);
    } else {
      setError(`不支持的文件格式: ${ext}`);
      setLoading(false);
    }

    return () => {
      // Cleanup on unmount or URL change
      if (prevSceneRef.current) {
        disposeScene(prevSceneRef.current);
        prevSceneRef.current = null;
      }
    };
  }, [url]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', minHeight: '300px' }}>
      <Canvas shadows dpr={[1, 1.5]} gl={PREVIEW_GL_PROPS}>
        <PerspectiveCamera makeDefault position={[0, 1.5, 4]} fov={45} />
        <PreviewLights />
        <PreviewEnvironment />

        {!loading && !error && modelScene ? <LoadedModel scene={modelScene} /> : null}

        <ContactShadows position={[0, -1.5, 0]} opacity={0.3} scale={10} blur={2.5} far={4} />
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          autoRotate
          autoRotateSpeed={0.8}
          minDistance={1}
          maxDistance={20}
        />
      </Canvas>
      {loading && (
        <div style={modelViewerOverlayStyle}>
          <div style={{ width: 36, height: 36, border: '3px solid #eee', borderTop: '3px solid #FF8C42', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ fontSize: '13px', margin: '4px 0', color: '#666' }}>加载模型中...</p>
          {loadProgress > 0 && loadProgress < 100 && (
            <p style={{ fontSize: '11px', color: '#999', margin: 0 }}>{loadProgress}%</p>
          )}
        </div>
      )}
      {!loading && error && (
        <div style={modelViewerOverlayStyle}>
          <p style={{ fontWeight: 600, color: '#e74c3c', margin: '0 0 6px' }}>加载失败</p>
          <p style={{ fontSize: '12px', color: '#999', margin: 0 }}>{error}</p>
        </div>
      )}
    </div>
  );
};

const modelViewerOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 5,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  pointerEvents: 'none',
  background: 'rgba(248, 249, 251, 0.72)',
};

/** Placeholder when no model is loaded */
const EmptyViewer: React.FC<{ message?: string; visualSrc?: string }> = ({ message, visualSrc }) => (
  <div style={{
    width: '100%', height: '100%', minHeight: '300px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(160deg, var(--bg-page) 0%, var(--bg-secondary) 100%)',
  }}>
    <div className="model-viewer-empty-card" style={{ textAlign: 'center' }}>
      {visualSrc ? (
        <img src={visualSrc} alt="" aria-hidden="true" />
      ) : (
        <div style={{
          width: 72, height: 72, margin: '0 auto 16px',
          background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)',
          borderRadius: '18px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '24px', color: 'white', fontWeight: 800,
          boxShadow: '0 8px 24px rgba(255, 140, 66, 0.25)',
        }}>
          3D
        </div>
      )}
      <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>开始生成你的 3D 模型</div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
        {message || '上传图片、输入描述或直接上传 3D 文件'}
      </p>
    </div>
  </div>
);

/** Demo mode viewer */
const DemoModelViewer: React.FC = () => (
  <EmptyViewer message="演示模式 - 配置 Tripo API Key 体验真实生成" />
);

/** Main export - routes between empty/demo/real viewer */
export default function ModelPreview({ url, emptyMessage }: { url?: string; emptyMessage?: string }) {
  if (!url) {
    return <EmptyViewer message={emptyMessage} />;
  }
  if (url.includes('demo')) {
    return <DemoModelViewer />;
  }
  return <ModelViewer url={url} />;
}

export { ModelViewer, EmptyViewer, DemoModelViewer, disposeScene };
