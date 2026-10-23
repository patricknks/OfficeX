import { useMemo } from 'react';
import * as THREE from 'three';
import type { RoleKind } from '../types';

/**
 * Static "uniform" per role, attached to the avatar body (scale 1 = the avatar's local space; the body group is
 * scaled 0.72 by the Avatar). Plain boxes, cylinders and tori with shared materials, so a floor of 20 agents adds
 * only a few dozen cheap draws. Colours of the body stay the team colour; props carry the role.
 */

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
const P = {
  navy: std('#1E293B'),
  ink: std('#26313B', { roughness: 0.4 }),
  white: std('#F8FAFC'),
  paper: std('#F1F5F9'),
  grey: std('#94A3B8'),
  leather: std('#8B5E34'),
  wood: std('#8B5E34'),
  screen: std('#0B1222', { roughness: 0.2 }),
  red: std('#EF4444'),
  cloak: new THREE.MeshStandardMaterial({ color: '#2E1065', roughness: 0.7, side: THREE.DoubleSide }),
  amber: std('#F59E0B', { emissive: '#F59E0B', emissiveIntensity: 0.4 }),
  sky: std('#38BDF8', { emissive: '#38BDF8', emissiveIntensity: 0.6 }),
  lens: new THREE.MeshStandardMaterial({ color: '#38BDF8', transparent: true, opacity: 0.35 }),
};
const glowCache = new Map<string, THREE.MeshStandardMaterial>();
const glow = (c: string, i = 0.9) => {
  const k = `${c}-${i}`;
  let m = glowCache.get(k);
  if (!m) glowCache.set(k, (m = std(c, { emissive: c, emissiveIntensity: i })));
  return m;
};
const plainCache = new Map<string, THREE.MeshStandardMaterial>();
const plain = (c: string) => {
  let m = plainCache.get(c);
  if (!m) plainCache.set(c, (m = std(c)));
  return m;
};

type V3 = [number, number, number];
function Box({ s, p, m, r }: { s: V3; p: V3; m: THREE.Material; r?: V3 }) {
  return (
    <mesh position={p} rotation={r} material={m} castShadow>
      <boxGeometry args={s} />
    </mesh>
  );
}
function Cyl({ r, h, p, m, rot, seg = 10 }: { r: number | [number, number]; h: number; p: V3; m: THREE.Material; rot?: V3; seg?: number }) {
  const [a, b] = Array.isArray(r) ? r : [r, r];
  return (
    <mesh position={p} rotation={rot} material={m} castShadow>
      <cylinderGeometry args={[a, b, h, seg]} />
    </mesh>
  );
}
function Ring({ r, t, p, m, rot }: { r: number; t: number; p: V3; m: THREE.Material; rot?: V3 }) {
  return (
    <mesh position={p} rotation={rot} material={m}>
      <torusGeometry args={[r, t, 8, 24]} />
    </mesh>
  );
}
function Ball({ r, p, m }: { r: number; p: V3; m: THREE.Material }) {
  return (
    <mesh position={p} material={m}>
      <sphereGeometry args={[r, 12, 12]} />
    </mesh>
  );
}

/** Props that sit on the body (chest, hands, shoulders). The body capsule is centred at y=0.82. */
export function BodyProps({ role, color }: { role: RoleKind; color: string }) {
  const accent = useMemo(() => glow(color), [color]);
  switch (role) {
    case 'manager':
      return (
        <group>
          <Box s={[0.5, 0.1, 0.42]} p={[0, 1.1, 0]} m={P.navy} />
          <Box s={[0.08, 0.3, 0.02]} p={[-0.09, 0.95, 0.26]} r={[0, 0, 0.2]} m={P.white} />
          <Box s={[0.08, 0.3, 0.02]} p={[0.09, 0.95, 0.26]} r={[0, 0, -0.2]} m={P.white} />
          <group position={[0.46, 0.8, 0.12]} rotation={[0, -0.4, 0]}>
            <Box s={[0.22, 0.3, 0.03]} p={[0, 0, 0]} m={P.paper} />
            <Box s={[0.1, 0.04, 0.04]} p={[0, 0.15, 0.01]} m={P.ink} />
            {[0, 1, 2].map((i) => (
              <Box key={i} s={[0.14, 0.02, 0.01]} p={[0, 0.07 - i * 0.07, 0.02]} m={P.grey} />
            ))}
          </group>
        </group>
      );
    case 'researcher':
      return (
        <group>
          <Box s={[0.14, 0.5, 0.03]} p={[-0.12, 0.78, 0.26]} r={[0, -0.1, 0]} m={P.white} />
          <Box s={[0.14, 0.5, 0.03]} p={[0.12, 0.78, 0.26]} r={[0, 0.1, 0]} m={P.white} />
          <group position={[0.5, 0.95, 0.15]} rotation={[0, 0, -0.5]}>
            <Ring r={0.1} t={0.025} p={[0, 0, 0]} m={P.ink} />
            <mesh material={P.lens}>
              <circleGeometry args={[0.09, 16]} />
            </mesh>
            <Cyl r={0.02} h={0.22} p={[0, -0.2, 0]} m={P.ink} seg={8} />
          </group>
          <Box s={[0.2, 0.22, 0.08]} p={[-0.4, 0.73, 0.05]} m={P.leather} />
          <Box s={[0.02, 0.5, 0.02]} p={[-0.2, 0.95, 0.1]} m={P.leather} />
        </group>
      );
    case 'analyst':
      return (
        <group>
          <group position={[0.5, 0.9, 0.1]} rotation={[0, -0.5, 0]}>
            <Box s={[0.26, 0.18, 0.02]} p={[0, 0, 0]} m={P.screen} />
            {[0, 1, 2, 3].map((i) => (
              <Box key={i} s={[0.03, 0.03 + i * 0.025, 0.01]} p={[-0.06 + i * 0.035, -0.05 + (0.03 + i * 0.025) / 2, 0.015]} m={accent} />
            ))}
          </group>
          {[0, 1, 2].map((r) => [0, 1, 2].map((k) => <Box key={`${r}${k}`} s={[0.05, 0.04, 0.02]} p={[-0.08 + k * 0.08, 0.95 - r * 0.07, 0.27]} m={P.white} />))}
        </group>
      );
    case 'reviewer':
      return (
        <group>
          <Cyl r={0.015} h={0.32} p={[0.46, 0.98, 0.14]} rot={[0, 0, -0.6]} m={P.red} seg={8} />
          <Ball r={0.018} p={[0.56, 1.1, 0.14]} m={P.ink} />
          <Box s={[0.2, 0.1, 0.02]} p={[0, 0.86, 0.27]} m={P.screen} />
          <Box s={[0.14, 0.05, 0.01]} p={[0, 0.86, 0.285]} m={accent} />
          <group position={[-0.48, 0.78, 0.1]} rotation={[0, 0.4, 0]}>
            <Box s={[0.24, 0.32, 0.03]} p={[0, 0, 0]} m={P.paper} />
            {[0, 1, 2].map((i) => (
              <group key={i}>
                <Box s={[0.05, 0.05, 0.01]} p={[-0.06, 0.1 - i * 0.09, 0.02]} m={glow('#22C55E', 0.5)} />
                <Box s={[0.1, 0.02, 0.01]} p={[0.04, 0.1 - i * 0.09, 0.02]} m={P.grey} />
              </group>
            ))}
          </group>
        </group>
      );
    case 'advisor':
      return (
        <group>
          <mesh position={[0, 0.78, 0]} material={P.cloak} castShadow>
            <coneGeometry args={[0.36, 0.9, 18, 1, true]} />
          </mesh>
          <group position={[0, 1.75, 0]}>
            {[0, 1, 2].map((i) => {
              const a = (i * Math.PI * 2) / 3;
              return <Ball key={i} r={0.045} p={[Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42]} m={glow(color, 1.2)} />;
            })}
            <Ring r={0.42} t={0.008} p={[0, 0, 0]} rot={[Math.PI / 2, 0, 0]} m={glow(color, 0.5)} />
          </group>
          <Cyl r={[0.02, 0.025]} h={1.3} p={[0.5, 0.75, 0.1]} m={P.wood} seg={8} />
          <Ball r={0.06} p={[0.5, 1.42, 0.1]} m={glow(color, 1)} />
        </group>
      );
    case 'secretary':
      return (
        <group>
          <Ring r={0.27} t={0.06} p={[0, 1.12, 0]} rot={[Math.PI / 2, 0, 0]} m={plain(color)} />
          <group position={[0.48, 0.92, 0.14]} rotation={[0, -0.5, 0]}>
            <Box s={[0.14, 0.24, 0.02]} p={[0, 0, 0]} m={P.screen} />
            <Box s={[0.09, 0.06, 0.01]} p={[-0.01, 0.04, 0.015]} m={P.sky} />
          </group>
          <mesh position={[-0.5, 1.0, 0.1]} material={P.amber} castShadow>
            <coneGeometry args={[0.07, 0.1, 12]} />
          </mesh>
          <Ball r={0.025} p={[-0.5, 0.94, 0.1]} m={P.amber} />
        </group>
      );
    default:
      return null;
  }
}

/** Props that move with the head (glasses, headsets, hoods). The head group is centred at the head box. */
export function HeadProps({ role, color }: { role: RoleKind; color: string }) {
  switch (role) {
    case 'manager':
      return (
        <group>
          <Ring r={0.25} t={0.018} p={[0, 0.08, 0]} m={plain(color)} />
          <Box s={[0.06, 0.1, 0.1]} p={[-0.26, 0, 0]} m={P.ink} />
        </group>
      );
    case 'researcher':
      return (
        <group>
          <Ring r={0.07} t={0.02} p={[-0.11, 0.2, 0.16]} m={P.ink} />
          <Ring r={0.07} t={0.02} p={[0.11, 0.2, 0.16]} m={P.ink} />
          <Box s={[0.3, 0.03, 0.03]} p={[0, 0.2, 0.16]} m={P.ink} />
        </group>
      );
    case 'analyst':
      return (
        <group>
          <Box s={[0.4, 0.16, 0.05]} p={[0, 0.01, 0.19]} m={P.screen} />
          {[0, 1, 2, 3, 4].map((i) => (
            <Box key={i} s={[0.04, 0.04 + i * 0.02, 0.02]} p={[-0.12 + i * 0.06, -0.04 + (0.04 + i * 0.02) / 2, 0.22]} m={glow(color, 1)} />
          ))}
        </group>
      );
    case 'reviewer':
      return (
        <group>
          <mesh position={[-0.09, 0.01, 0.2]} scale={[1, 0.6, 1]} material={P.white}>
            <torusGeometry args={[0.06, 0.012, 8, 20]} />
          </mesh>
          <mesh position={[0.09, 0.01, 0.2]} scale={[1, 0.6, 1]} material={P.white}>
            <torusGeometry args={[0.06, 0.012, 8, 20]} />
          </mesh>
          <Box s={[0.06, 0.01, 0.01]} p={[0, 0.03, 0.2]} m={P.white} />
        </group>
      );
    case 'advisor':
      return (
        <mesh position={[0, 0.1, -0.12]} scale={[1.05, 0.9, 1.05]} material={P.cloak}>
          <sphereGeometry args={[0.3, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        </mesh>
      );
    case 'secretary':
      return (
        <group>
          <Ring r={0.25} t={0.018} p={[0, 0.08, 0]} m={P.ink} />
          <Box s={[0.06, 0.1, 0.1]} p={[0.26, 0, 0]} m={P.ink} />
          <Cyl r={0.01} h={0.18} p={[0.22, -0.08, 0.12]} rot={[0, 0, 0.5]} m={P.ink} seg={6} />
          <Ball r={0.025} p={[0.14, -0.14, 0.2]} m={P.ink} />
        </group>
      );
    default:
      return null;
  }
}
