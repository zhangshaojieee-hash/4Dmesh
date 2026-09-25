import React, { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls as ThreeTransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export type OrbitControlsLike = ThreeOrbitControls;
export type TransformControlsLike = ThreeTransformControls;

type OrbitControlsProps = {
  makeDefault?: boolean;
  enableDamping?: boolean;
  dampingFactor?: number;
  minDistance?: number;
  maxDistance?: number;
  enableRotate?: boolean;
  enablePan?: boolean;
  enableZoom?: boolean;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  mouseButtons?: Partial<Record<keyof typeof THREE.MOUSE, THREE.MOUSE | undefined>>;
  disableRotatePanWhileShift?: boolean;
};

export const OrbitControls = React.forwardRef<OrbitControlsLike, OrbitControlsProps>((props, ref) => {
  const { camera, gl, invalidate, controls: previousControls, set } = useThree();
  const controls = useMemo(() => new ThreeOrbitControls(camera, gl.domElement), [camera, gl.domElement]);

  useEffect(() => {
    controls.enableDamping = props.enableDamping ?? false;
    controls.dampingFactor = props.dampingFactor ?? 0.05;
    controls.minDistance = props.minDistance ?? 0;
    controls.maxDistance = props.maxDistance ?? Infinity;
    controls.enableRotate = props.enableRotate ?? true;
    controls.enablePan = props.enablePan ?? true;
    controls.enableZoom = props.enableZoom ?? true;
    controls.autoRotate = props.autoRotate ?? false;
    controls.autoRotateSpeed = props.autoRotateSpeed ?? 2;
    if (props.mouseButtons) {
      controls.mouseButtons = { ...controls.mouseButtons, ...props.mouseButtons };
    }
    controls.update();
    if (!props.disableRotatePanWhileShift) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!event.shiftKey) return;
      controls.enableRotate = false;
      controls.enablePan = false;
    };
    const onPointerUp = () => {
      controls.enableRotate = props.enableRotate ?? true;
      controls.enablePan = props.enablePan ?? true;
    };
    gl.domElement.addEventListener('pointerdown', onPointerDown, true);
    gl.domElement.addEventListener('pointerup', onPointerUp, true);
    gl.domElement.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      gl.domElement.removeEventListener('pointerdown', onPointerDown, true);
      gl.domElement.removeEventListener('pointerup', onPointerUp, true);
      gl.domElement.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, [
    controls,
    props.autoRotate,
    props.autoRotateSpeed,
    props.dampingFactor,
    props.enableDamping,
    props.enablePan,
    props.enableRotate,
    props.enableZoom,
    props.mouseButtons,
    props.maxDistance,
    props.minDistance,
    props.disableRotatePanWhileShift,
    gl,
  ]);

  useEffect(() => {
    const onChange = () => invalidate();
    controls.addEventListener('change', onChange);
    return () => controls.removeEventListener('change', onChange);
  }, [controls, invalidate]);

  useEffect(() => {
    if (!props.makeDefault) return undefined;
    set({ controls });
    return () => set({ controls: previousControls });
  }, [controls, previousControls, props.makeDefault, set]);

  useEffect(() => () => controls.dispose(), [controls]);
  useFrame(() => controls.update());

  React.useImperativeHandle(ref, () => controls, [controls]);
  return null;
});

OrbitControls.displayName = 'OrbitControls';

type TransformControlsProps = {
  object?: THREE.Object3D | null;
  mode?: 'translate' | 'rotate' | 'scale';
  onObjectChange?: () => void;
};

export const TransformControls = React.forwardRef<TransformControlsLike, TransformControlsProps>((props, ref) => {
  const { camera, gl, scene, invalidate } = useThree();
  const controls = useMemo(() => new ThreeTransformControls(camera, gl.domElement), [camera, gl.domElement]);

  useEffect(() => {
    const controlsRoot = controls.getHelper();
    scene.add(controlsRoot);
    return () => {
      controls.detach();
      scene.remove(controlsRoot);
      controls.dispose();
    };
  }, [controls, scene]);

  useEffect(() => {
    if (props.object) controls.attach(props.object);
    else controls.detach();
  }, [controls, props.object]);

  useEffect(() => {
    controls.setMode(props.mode ?? 'translate');
  }, [controls, props.mode]);

  useEffect(() => {
    const onChange = () => invalidate();
    const onObjectChange = () => props.onObjectChange?.();
    controls.addEventListener('change', onChange);
    controls.addEventListener('objectChange', onObjectChange);
    return () => {
      controls.removeEventListener('change', onChange);
      controls.removeEventListener('objectChange', onObjectChange);
    };
  }, [controls, invalidate, props]);

  React.useImperativeHandle(ref, () => controls, [controls]);
  return null;
});

TransformControls.displayName = 'TransformControls';

export const PerspectiveCamera: React.FC<{
  makeDefault?: boolean;
  position?: [number, number, number];
  fov?: number;
}> = ({ makeDefault, position = [0, 0, 5], fov = 50 }) => {
  const camera = useMemo(() => new THREE.PerspectiveCamera(fov), [fov]);
  const { set, size, camera: previousCamera } = useThree();

  useEffect(() => {
    camera.position.set(...position);
  }, [camera, position]);

  useEffect(() => {
    camera.aspect = size.width / Math.max(size.height, 1);
    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width]);

  useEffect(() => {
    if (!makeDefault) return undefined;
    set({ camera });
    return () => set({ camera: previousCamera });
  }, [camera, makeDefault, previousCamera, set]);

  return <primitive object={camera} />;
};

export const Line: React.FC<{
  points: Array<THREE.Vector3 | [number, number, number]>;
  color: string;
  lineWidth?: number;
}> = ({ points, color, lineWidth = 1 }) => {
  const line = useMemo(() => {
    const positions: number[] = [];
    for (const point of points) {
      if (Array.isArray(point)) positions.push(point[0], point[1], point[2]);
      else positions.push(point.x, point.y, point.z);
    }
    const nextGeometry = new THREE.BufferGeometry();
    nextGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color, linewidth: lineWidth });
    return new THREE.Line(nextGeometry, material);
  }, [color, lineWidth, points]);

  useEffect(() => () => {
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
  }, [line]);

  return <primitive object={line} />;
};

export const TextLabel: React.FC<{
  text: string;
  position: [number, number, number];
  color?: string;
  background?: string;
  scale?: number;
}> = ({ text, position, color = '#FFFFFF', background = 'rgba(15, 23, 42, 0.76)', scale = 10 }) => {
  const { texture, aspect } = useMemo(() => {
    const pixelRatio = 2;
    const fontSize = 28;
    const horizontalPadding = 16;
    const verticalPadding = 8;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      const fallbackTexture = new THREE.CanvasTexture(canvas);
      return { texture: fallbackTexture, aspect: 1 };
    }

    context.font = `800 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const metrics = context.measureText(text);
    const width = Math.ceil(metrics.width + horizontalPadding * 2);
    const height = Math.ceil(fontSize + verticalPadding * 2);
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    context.scale(pixelRatio, pixelRatio);
    context.font = `800 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = background;
    context.beginPath();
    context.roundRect(0, 0, width, height, 8);
    context.fill();
    context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = color;
    context.fillText(text, width / 2, height / 2);

    const labelTexture = new THREE.CanvasTexture(canvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    labelTexture.needsUpdate = true;
    return { texture: labelTexture, aspect: width / Math.max(height, 1) };
  }, [background, color, text]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={position} scale={[scale * aspect, scale, 1]}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
};

export const Grid: React.FC<{
  args?: [number, number];
  cellColor?: string;
  sectionColor?: string;
  position?: [number, number, number];
  fadeDistance?: number;
  fadeStrength?: number;
}> = ({ args = [20, 20], cellColor = '#D1D5DB', sectionColor = '#94A3B8', position = [0, 0, 0] }) => {
  const divisions = Math.max(1, Math.round(args[1]));
  return (
    <gridHelper
      args={[args[0], divisions, sectionColor, cellColor]}
      position={position}
    />
  );
};

export const ContactShadows: React.FC<{
  position?: [number, number, number];
  opacity?: number;
  scale?: number;
  blur?: number;
  far?: number;
}> = ({ position = [0, 0, 0], opacity = 0.24, scale = 10 }) => (
  <mesh rotation={[-Math.PI / 2, 0, 0]} position={position} receiveShadow>
    <circleGeometry args={[scale / 2, 48]} />
    <meshBasicMaterial color="#0F172A" transparent opacity={opacity} depthWrite={false} />
  </mesh>
);
