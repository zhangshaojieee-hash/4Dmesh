import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type AssistantPhase = 'offline' | 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking';

interface AssistantAvatarProps {
  phase: AssistantPhase;
}

interface AvatarPalette {
  skin: string;
  hair: string;
  hairShadow: string;
  accent: string;
  accentDeep: string;
  dress: string;
  dressShadow: string;
  gold: string;
  lip: string;
  cheek: string;
  ring: string;
}

interface MotionProfile {
  bob: number;
  sway: number;
  gaze: number;
  mouth: number;
  ring: number;
}

const PHASE_LABELS: Record<AssistantPhase, string> = {
  offline: '离线',
  connecting: '连接中',
  idle: '待命',
  listening: '聆听中',
  thinking: '思考中',
  speaking: '说话中',
};

const BASE_PALETTE: AvatarPalette = {
  skin: '#f4d1c4',
  hair: '#f8fbff',
  hairShadow: '#bfd6ef',
  accent: '#79dfff',
  accentDeep: '#4188ea',
  dress: '#eef6ff',
  dressShadow: '#c1d5ea',
  gold: '#d8b06a',
  lip: '#934767',
  cheek: '#f0a1be',
  ring: '#b9eaff',
};

const PALETTE_BY_PHASE: Record<AssistantPhase, AvatarPalette> = {
  offline: {
    ...BASE_PALETTE,
    skin: '#edd0c5',
    hair: '#f3f7fd',
    hairShadow: '#b8cfe3',
    accent: '#8fbfde',
    accentDeep: '#5b88c1',
    dress: '#e8f0f7',
    dressShadow: '#b9cad9',
    ring: '#95b2cc',
  },
  connecting: {
    ...BASE_PALETTE,
    accent: '#8be8ff',
    accentDeep: '#3c8df0',
    ring: '#c8f7ff',
  },
  idle: BASE_PALETTE,
  listening: {
    ...BASE_PALETTE,
    accent: '#8ff2ff',
    accentDeep: '#4d95f4',
    ring: '#d4fbff',
  },
  thinking: {
    ...BASE_PALETTE,
    accent: '#7ccfff',
    accentDeep: '#397ce8',
    ring: '#c6ecff',
  },
  speaking: {
    ...BASE_PALETTE,
    accent: '#97e8ff',
    accentDeep: '#4c9cf1',
    ring: '#d4fbff',
  },
};

const MOTION_BY_PHASE: Record<AssistantPhase, MotionProfile> = {
  offline: { bob: 0.45, sway: 0.25, gaze: 0.03, mouth: 0.08, ring: 0.18 },
  connecting: { bob: 0.95, sway: 0.42, gaze: 0.06, mouth: 0.12, ring: 0.42 },
  idle: { bob: 0.95, sway: 0.35, gaze: 0.04, mouth: 0.10, ring: 0.22 },
  listening: { bob: 1.18, sway: 0.48, gaze: 0.09, mouth: 0.18, ring: 0.30 },
  thinking: { bob: 1.05, sway: 0.52, gaze: 0.16, mouth: 0.24, ring: 0.34 },
  speaking: { bob: 1.28, sway: 0.40, gaze: 0.05, mouth: 0.96, ring: 0.26 },
};

const PERSONAL_AVATAR_SOURCES = [
  '/assistant/furina.webp',
  '/assistant/furina.png',
  '/assistant/furina.jpg',
];

const AVATAR_STYLES = `
.assistant-avatar {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #17304e;
  user-select: none;
}

.assistant-avatar__scene {
  width: min(100%, 218px);
  aspect-ratio: 16 / 11;
  position: relative;
  overflow: hidden;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(246, 251, 255, 0.98) 0%, rgba(236, 246, 255, 0.94) 100%);
  isolation: isolate;
  pointer-events: none;
}

.assistant-avatar__scene::before {
  content: '';
  position: absolute;
  inset: 12px 14px 16px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 42%, rgba(154, 231, 255, 0.28), rgba(110, 169, 255, 0.10) 42%, transparent 70%);
  filter: blur(1px);
  pointer-events: none;
}

.assistant-avatar__shadow {
  position: absolute;
  left: 50%;
  bottom: 16px;
  width: 66%;
  height: 18px;
  transform: translateX(-50%);
  background: radial-gradient(circle at 50% 50%, rgba(16, 42, 78, 0.18), rgba(16, 42, 78, 0) 72%);
  filter: blur(8px);
  z-index: 0;
}

.assistant-avatar__canvas {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.assistant-avatar__portrait {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 18%;
  transform: scale(1.02);
}

.assistant-avatar__meter {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
  height: 18px;
  opacity: 0.76;
}

.assistant-avatar__bar {
  width: 6px;
  height: 6px;
  border-radius: 999px 999px 3px 3px;
  background: linear-gradient(180deg, #9ae8ff 0%, #4e9af0 100%);
  transform-origin: center bottom;
  animation: assistant-avatar-meter 1.18s ease-in-out infinite;
}

.assistant-avatar__bar:nth-child(1) { animation-delay: 0s; }
.assistant-avatar__bar:nth-child(2) { animation-delay: 0.12s; }
.assistant-avatar__bar:nth-child(3) { animation-delay: 0.24s; }
.assistant-avatar__bar:nth-child(4) { animation-delay: 0.36s; }
.assistant-avatar__bar:nth-child(5) { animation-delay: 0.48s; }

.assistant-avatar--idle .assistant-avatar__meter {
  opacity: 0.42;
}

.assistant-avatar--offline .assistant-avatar__meter {
  opacity: 0.28;
}

.assistant-avatar--thinking .assistant-avatar__meter {
  opacity: 0.98;
}

.assistant-avatar--speaking .assistant-avatar__meter,
.assistant-avatar--listening .assistant-avatar__meter,
.assistant-avatar--connecting .assistant-avatar__meter {
  opacity: 1;
}

.assistant-avatar__caption {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  line-height: 1;
}

.assistant-avatar__name {
  font-size: 0.84rem;
  font-weight: 700;
  letter-spacing: 0;
  color: #17304e;
}

.assistant-avatar__state {
  font-size: 0.72rem;
  color: #607690;
}

.assistant-avatar--offline .assistant-avatar__name,
.assistant-avatar--offline .assistant-avatar__state {
  color: #72839b;
}

.assistant-avatar--connecting .assistant-avatar__state,
.assistant-avatar--listening .assistant-avatar__state,
.assistant-avatar--speaking .assistant-avatar__state,
.assistant-avatar--thinking .assistant-avatar__state {
  color: #3b6db2;
}

@keyframes assistant-avatar-meter {
  0%, 100% { transform: scaleY(0.52); }
  50% { transform: scaleY(1.22); }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-avatar__bar {
    animation: none !important;
  }
}
`;

const blinkValue = (t: number, offset: number, strength: number, reducedMotion: boolean) => {
  const speed = reducedMotion ? 0.6 : 1;
  const wave = Math.sin(t * 1.08 * speed + offset) * 0.5 + 0.5;
  const blink = Math.pow(Math.max(0, wave), 16);
  return 1 - blink * strength;
};

const AvatarRig: React.FC<{
  phase: AssistantPhase;
  palette: AvatarPalette;
  motion: MotionProfile;
  reducedMotion: boolean;
}> = ({ phase, palette, motion, reducedMotion }) => {
  const rootRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const hatRef = useRef<THREE.Group>(null);
  const leftEyeRef = useRef<THREE.Group>(null);
  const rightEyeRef = useRef<THREE.Group>(null);
  const leftPupilRef = useRef<THREE.Group>(null);
  const rightPupilRef = useRef<THREE.Group>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const leftTailRef = useRef<THREE.Group>(null);
  const rightTailRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const speed = reducedMotion ? 0.55 : 1;
    const bobScale = reducedMotion ? 0.015 : 0.032;
    const swayScale = reducedMotion ? 0.012 : 0.038;

    if (rootRef.current) {
      rootRef.current.position.y = Math.sin(t * 1.42 * speed) * motion.bob * bobScale;
      rootRef.current.rotation.y = Math.sin(t * 0.68 * speed) * motion.sway * swayScale;
      rootRef.current.rotation.z = Math.sin(t * 0.92 * speed) * 0.016;
    }

    if (ringRef.current) {
      ringRef.current.rotation.z = t * motion.ring * (reducedMotion ? 0.12 : 1);
      ringRef.current.rotation.x = 0.72 + Math.sin(t * 0.74 * speed) * 0.12;
      ringRef.current.rotation.y = Math.sin(t * 0.5 * speed) * 0.14;
    }

    if (hatRef.current) {
      hatRef.current.rotation.z = Math.sin(t * 0.62 * speed) * 0.03;
      hatRef.current.position.y = 0.01 + Math.sin(t * 0.9 * speed) * 0.01;
    }

    const blinkStrength = phase === 'speaking' ? 0.76 : 0.82;
    if (leftEyeRef.current) {
      leftEyeRef.current.scale.y = blinkValue(t, 0, blinkStrength, reducedMotion);
    }
    if (rightEyeRef.current) {
      rightEyeRef.current.scale.y = blinkValue(t, 1.7, blinkStrength, reducedMotion);
    }

    const gazeOffset = phase === 'thinking'
      ? Math.sin(t * 0.82 * speed) * motion.gaze
      : phase === 'listening'
        ? Math.sin(t * 1.18 * speed) * motion.gaze * 0.62
        : 0;

    if (leftPupilRef.current) {
      leftPupilRef.current.position.x = -0.003 + gazeOffset * 0.8;
      leftPupilRef.current.position.y = phase === 'thinking' ? 0.006 : 0;
    }
    if (rightPupilRef.current) {
      rightPupilRef.current.position.x = 0.003 + gazeOffset * 0.8;
      rightPupilRef.current.position.y = phase === 'thinking' ? 0.006 : 0;
    }

    if (mouthRef.current) {
      const speakingPulse = 0.9 + Math.sin(t * (phase === 'speaking' ? 14 : 8) * speed) * 0.22;
      const base = phase === 'speaking'
        ? speakingPulse * motion.mouth
        : phase === 'thinking'
          ? 0.26
          : phase === 'listening'
            ? 0.16
            : 0.1;
      mouthRef.current.scale.set(1, base, 1);
      mouthRef.current.rotation.z = phase === 'speaking' ? Math.sin(t * 4.5 * speed) * 0.04 : 0;
    }

    if (leftTailRef.current) {
      leftTailRef.current.rotation.z = -0.42 + Math.sin(t * 0.92 * speed) * 0.06;
      leftTailRef.current.rotation.y = Math.sin(t * 0.62 * speed) * 0.04;
    }
    if (rightTailRef.current) {
      rightTailRef.current.rotation.z = 0.42 + Math.sin(t * 0.92 * speed + 1.2) * 0.06;
      rightTailRef.current.rotation.y = Math.sin(t * 0.62 * speed + 0.8) * -0.04;
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.02, 0]}>
      <mesh ref={ringRef} position={[0, 0.22, -0.54]} rotation={[0.76, 0.15, 0]}>
        <torusGeometry args={[0.92, 0.03, 8, 36]} />
        <meshBasicMaterial color={palette.ring} transparent opacity={phase === 'offline' ? 0.24 : 0.66} />
      </mesh>

      <group position={[0, 0.90, 0.1]}>
        <group ref={hatRef}>
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.34, 0.42, 0.08, 10]} />
            <meshStandardMaterial color={palette.gold} roughness={0.55} metalness={0.08} flatShading />
          </mesh>
          <mesh position={[0, 0.14, 0]}>
            <cylinderGeometry args={[0.22, 0.28, 0.24, 10]} />
            <meshStandardMaterial color={palette.accentDeep} roughness={0.64} metalness={0.04} flatShading />
          </mesh>
          <mesh position={[0, 0.30, 0.02]}>
            <coneGeometry args={[0.12, 0.22, 10]} />
            <meshStandardMaterial color={palette.accent} roughness={0.52} metalness={0.05} flatShading />
          </mesh>
          <mesh position={[0, 0.40, 0.06]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshStandardMaterial color="#fff7db" roughness={0.26} metalness={0.08} />
          </mesh>
        </group>
      </group>

      <mesh position={[0, -0.08, -0.24]} scale={[1.18, 1.28, 1.06]}>
        <sphereGeometry args={[0.74, 18, 14]} />
        <meshStandardMaterial color={palette.hair} roughness={0.82} metalness={0.01} flatShading />
      </mesh>

      <group ref={leftTailRef} position={[-0.58, -0.02, -0.15]} rotation={[0.04, 0.0, -0.42]}>
        <mesh position={[0, -0.02, 0.02]} rotation={[0.0, 0.0, 0.08]}>
          <cylinderGeometry args={[0.14, 0.18, 1.08, 8]} />
          <meshStandardMaterial color={palette.hairShadow} roughness={0.82} flatShading />
        </mesh>
        <mesh position={[0, -0.63, 0.02]} scale={[1, 1.08, 1]}>
          <sphereGeometry args={[0.17, 10, 8]} />
          <meshStandardMaterial color={palette.accent} roughness={0.55} flatShading />
        </mesh>
      </group>

      <group ref={rightTailRef} position={[0.58, -0.02, -0.15]} rotation={[0.04, 0, 0.42]}>
        <mesh position={[0, -0.02, 0.02]} rotation={[0.0, 0.0, -0.08]}>
          <cylinderGeometry args={[0.14, 0.18, 1.08, 8]} />
          <meshStandardMaterial color={palette.hairShadow} roughness={0.82} flatShading />
        </mesh>
        <mesh position={[0, -0.63, 0.02]} scale={[1, 1.08, 1]}>
          <sphereGeometry args={[0.17, 10, 8]} />
          <meshStandardMaterial color={palette.accent} roughness={0.55} flatShading />
        </mesh>
      </group>

      <group position={[0, 0.16, 0.12]}>
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[0.62, 20, 16]} />
          <meshStandardMaterial color={palette.skin} roughness={0.72} metalness={0.01} />
        </mesh>

        <mesh position={[0, 0.05, 0.26]} scale={[1.06, 0.72, 0.92]} rotation={[0.22, 0, 0]}>
          <sphereGeometry args={[0.58, 16, 14]} />
          <meshStandardMaterial color={palette.hairShadow} roughness={0.86} metalness={0.01} flatShading />
        </mesh>

        <mesh position={[-0.28, 0.24, 0.2]} scale={[0.76, 0.42, 0.64]} rotation={[0.36, 0.18, -0.12]}>
          <sphereGeometry args={[0.30, 12, 10]} />
          <meshStandardMaterial color={palette.hair} roughness={0.84} metalness={0.01} flatShading />
        </mesh>
        <mesh position={[0.28, 0.24, 0.2]} scale={[0.76, 0.42, 0.64]} rotation={[0.36, -0.18, 0.12]}>
          <sphereGeometry args={[0.30, 12, 10]} />
          <meshStandardMaterial color={palette.hair} roughness={0.84} metalness={0.01} flatShading />
        </mesh>

        <mesh position={[0, 0.34, 0.22]} scale={[1.04, 0.54, 0.84]} rotation={[0.1, 0, 0]}>
          <sphereGeometry args={[0.52, 16, 12]} />
          <meshStandardMaterial color={palette.hair} roughness={0.82} metalness={0.01} flatShading />
        </mesh>

        <group position={[-0.19, 0.08, 0.58]} ref={leftEyeRef}>
          <mesh>
            <sphereGeometry args={[0.09, 12, 12]} />
            <meshStandardMaterial color="#fffdf9" roughness={0.18} metalness={0.01} />
          </mesh>
          <group ref={leftPupilRef} position={[0, 0, 0.05]}>
            <mesh>
              <sphereGeometry args={[0.055, 12, 12]} />
              <meshStandardMaterial color={palette.accentDeep} roughness={0.42} metalness={0.02} />
            </mesh>
            <mesh position={[0.016, 0.02, 0.03]}>
              <sphereGeometry args={[0.016, 8, 8]} />
              <meshStandardMaterial color="#ffffff" />
            </mesh>
          </group>
        </group>

        <group position={[0.19, 0.08, 0.58]} ref={rightEyeRef}>
          <mesh>
            <sphereGeometry args={[0.09, 12, 12]} />
            <meshStandardMaterial color="#fffdf9" roughness={0.18} metalness={0.01} />
          </mesh>
          <group ref={rightPupilRef} position={[0, 0, 0.05]}>
            <mesh>
              <sphereGeometry args={[0.055, 12, 12]} />
              <meshStandardMaterial color={palette.accentDeep} roughness={0.42} metalness={0.02} />
            </mesh>
            <mesh position={[0.016, 0.02, 0.03]}>
              <sphereGeometry args={[0.016, 8, 8]} />
              <meshStandardMaterial color="#ffffff" />
            </mesh>
          </group>
        </group>

        <mesh position={[-0.28, -0.02, 0.47]}>
          <sphereGeometry args={[0.055, 10, 10]} />
          <meshBasicMaterial color={palette.cheek} transparent opacity={phase === 'offline' ? 0.06 : 0.24} />
        </mesh>
        <mesh position={[0.28, -0.02, 0.47]}>
          <sphereGeometry args={[0.055, 10, 10]} />
          <meshBasicMaterial color={palette.cheek} transparent opacity={phase === 'offline' ? 0.06 : 0.24} />
        </mesh>

        <mesh ref={mouthRef} position={[0, -0.12, 0.56]} scale={[1, 0.12, 1]}>
          <sphereGeometry args={[0.07, 10, 8]} />
          <meshStandardMaterial color={palette.lip} roughness={0.44} metalness={0.01} />
        </mesh>
      </group>

      <group position={[0, -0.60, 0.02]}>
        <mesh position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.88, 0.72, 1.18, 7]} />
          <meshStandardMaterial color={palette.dress} roughness={0.76} metalness={0.01} flatShading />
        </mesh>
        <mesh position={[0, 0.20, 0.18]}>
          <cylinderGeometry args={[0.44, 0.30, 0.18, 7]} />
          <meshStandardMaterial color={palette.dressShadow} roughness={0.72} metalness={0.01} flatShading />
        </mesh>
        <mesh position={[0, 0.24, 0.30]}>
          <torusGeometry args={[0.22, 0.05, 8, 22]} />
          <meshStandardMaterial color={palette.accent} roughness={0.5} metalness={0.03} />
        </mesh>
        <mesh position={[0, 0.27, 0.38]}>
          <sphereGeometry args={[0.06, 10, 8]} />
          <meshStandardMaterial color={palette.gold} roughness={0.44} metalness={0.06} />
        </mesh>
      </group>
    </group>
  );
};

const usePrefersReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return reducedMotion;
};

const canLoadImage = (src: string) => new Promise<boolean>((resolve) => {
  const image = new Image();
  image.onload = () => resolve(true);
  image.onerror = () => resolve(false);
  image.src = src;
});

const AssistantAvatar: React.FC<AssistantAvatarProps> = ({ phase }) => {
  const reducedMotion = usePrefersReducedMotion();
  const palette = useMemo(() => PALETTE_BY_PHASE[phase], [phase]);
  const motion = useMemo(() => MOTION_BY_PHASE[phase], [phase]);
  const [personalAvatarSrc, setPersonalAvatarSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const src of PERSONAL_AVATAR_SOURCES) {
        if (await canLoadImage(src)) {
          if (!cancelled) setPersonalAvatarSrc(src);
          return;
        }
      }
      if (!cancelled) setPersonalAvatarSrc(null);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className={`assistant-avatar assistant-avatar--${phase}`}>
      <style>{AVATAR_STYLES}</style>
      <div className="assistant-avatar__scene" role="img" aria-label={`芙宁娜风格助手，当前状态：${PHASE_LABELS[phase]}`}>
        <div className="assistant-avatar__shadow" />
        {personalAvatarSrc ? (
          <img className="assistant-avatar__portrait" src={personalAvatarSrc} alt="" aria-hidden="true" />
        ) : (
          <Canvas
            className="assistant-avatar__canvas"
            dpr={[1, 1.15]}
            frameloop="always"
            orthographic
            camera={{ position: [0, 0, 7.8], zoom: 78, near: 0.1, far: 100 }}
            gl={{ antialias: false, alpha: true, powerPreference: 'low-power', stencil: false, depth: true }}
          >
            <ambientLight intensity={1.55} />
            <directionalLight position={[4, 6, 8]} intensity={1.2} color="#ffffff" />
            <directionalLight position={[-4, 2, 6]} intensity={0.72} color={palette.ring} />
            <pointLight position={[0, 2.2, 5]} intensity={0.55} color={palette.accent} />
            <AvatarRig phase={phase} palette={palette} motion={motion} reducedMotion={reducedMotion} />
          </Canvas>
        )}
      </div>

      <div className="assistant-avatar__meter" aria-hidden="true">
        <span className="assistant-avatar__bar" />
        <span className="assistant-avatar__bar" />
        <span className="assistant-avatar__bar" />
        <span className="assistant-avatar__bar" />
        <span className="assistant-avatar__bar" />
      </div>

      <div className="assistant-avatar__caption">
        <span className="assistant-avatar__name">芙宁娜风助手</span>
        <span className="assistant-avatar__state">{PHASE_LABELS[phase]}</span>
      </div>
    </div>
  );
};

export default AssistantAvatar;
