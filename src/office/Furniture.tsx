import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { M } from './materials';
import type { ShownStatus } from '../types';

type V3 = [number, number, number];

/** A box with its base at y (p[1] is the bottom), which keeps furniture code readable. */
export function B({ p, s, m, ry = 0, shadow = true }: { p: V3; s: V3; m: THREE.Material; ry?: number; shadow?: boolean }) {
  return (
    <mesh position={[p[0], p[1] + s[1] / 2, p[2]]} rotation-y={ry} material={m} castShadow={shadow} receiveShadow>
      <boxGeometry args={s} />
    </mesh>
  );
}

export function Plant({ p, size = 1 }: { p: V3; size?: number }) {
  return (
    <group position={p} scale={size}>
      <mesh position={[0, 0.18, 0]} material={M.pot} castShadow>
        <cylinderGeometry args={[0.16, 0.12, 0.36, 12]} />
      </mesh>
      <mesh position={[0, 0.62, 0]} material={M.plant} castShadow>
        <icosahedronGeometry args={[0.3, 0]} />
      </mesh>
      <mesh position={[0.12, 0.86, 0.05]} material={M.plantDark} castShadow>
        <icosahedronGeometry args={[0.2, 0]} />
      </mesh>
      <mesh position={[-0.1, 0.8, -0.08]} material={M.plantDark} castShadow>
        <icosahedronGeometry args={[0.17, 0]} />
      </mesh>
    </group>
  );
}

export function TallPlant({ p }: { p: V3 }) {
  return (
    <group position={p}>
      <mesh position={[0, 0.22, 0]} material={M.pot} castShadow>
        <cylinderGeometry args={[0.2, 0.15, 0.44, 12]} />
      </mesh>
      {[0.75, 1.1, 1.4].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} material={i % 2 ? M.plantDark : M.plant} castShadow>
          <coneGeometry args={[0.38 - i * 0.09, 0.55, 7]} />
        </mesh>
      ))}
    </group>
  );
}

export function Shelf({ p, ry = 0, w = 1.4 }: { p: V3; ry?: number; w?: number }) {
  return (
    <group position={p} rotation-y={ry}>
      <B p={[0, 0, 0]} s={[w, 1.5, 0.35]} m={M.wood} />
      {/* books as a few coloured blocks per shelf: cheap to draw, reads the same from afar */}
      {[0.35, 0.8, 1.22].map((y, row) =>
        [0, 1, 2].map((i) => {
          const bw = (w - 0.3) / 3 - 0.06;
          return (
            <B
              key={`${row}-${i}`}
              p={[-w / 2 + 0.15 + bw / 2 + i * (bw + 0.06), y, 0.06]}
              s={[bw, 0.3 - ((i + row) % 3) * 0.05, 0.24]}
              m={M.books[(i * 2 + row) % M.books.length]}
              shadow={false}
            />
          );
        }),
      )}
    </group>
  );
}

export function Rug({ p, s, m }: { p: V3; s: [number, number]; m: THREE.Material }) {
  return (
    <mesh position={[p[0], p[1] + 0.012, p[2]]} rotation-x={-Math.PI / 2} material={m} receiveShadow>
      <planeGeometry args={s} />
    </mesh>
  );
}

const LAMP_ON: ShownStatus[] = ['thinking', 'tool', 'messaging'];

/** A desk with a monitor whose top edge shows the status of whoever sits there. */
export function Desk({ p, color, status, present }: { p: V3; color: string; status?: ShownStatus; present: boolean }) {
  const lamp = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!lamp.current) return;
    const on = present && status && LAMP_ON.includes(status);
    lamp.current.emissiveIntensity = on ? 1.5 + Math.sin(clock.elapsedTime * (status === 'tool' ? 10 : 3)) * 0.7 : present && status === 'waiting' ? 0.5 : 0.05;
  });
  return (
    <group position={p} scale={0.72}>
      <B p={[0, 0.7, 0]} s={[1.7, 0.08, 0.85]} m={M.white} />
      {[
        [-0.75, 0.33],
        [0.75, 0.33],
        [-0.75, -0.33],
        [0.75, -0.33],
      ].map(([x, z], i) => (
        <B key={i} p={[x, 0, z]} s={[0.06, 0.7, 0.06]} m={M.grey} shadow={false} />
      ))}
      <group position={[0, 0.78, 0.12]}>
        <B p={[0, 0.2, 0]} s={[0.78, 0.46, 0.05]} m={M.charcoal} />
        <B p={[0, 0, 0]} s={[0.06, 0.2, 0.05]} m={M.charcoal} shadow={false} />
        <mesh position={[0, 0.68, 0]}>
          <boxGeometry args={[0.7, 0.03, 0.06]} />
          <meshStandardMaterial ref={lamp} color={color} emissive={color} emissiveIntensity={0.05} toneMapped={false} />
        </mesh>
      </group>
      <B p={[0.58, 0.78, 0.18]} s={[0.28, 0.04, 0.36]} m={M.paper} ry={0.3} shadow={false} />
      <mesh position={[-0.6, 0.86, 0.1]} material={M.pot} castShadow>
        <cylinderGeometry args={[0.07, 0.06, 0.16, 10]} />
      </mesh>
      {/* chair */}
      <B p={[0, 0.36, -0.66]} s={[0.6, 0.08, 0.55]} m={M.chair} shadow={false} />
      <B p={[0, 0.44, -0.93]} s={[0.6, 0.55, 0.08]} m={M.chair} shadow={false} />
      <B p={[0, 0, -0.66]} s={[0.07, 0.36, 0.07]} m={M.chair} shadow={false} />
    </group>
  );
}

export function Sofa({ p, ry = 0, w = 3, m }: { p: V3; ry?: number; w?: number; m: THREE.Material }) {
  return (
    <group position={p} rotation-y={ry}>
      <B p={[0, 0, 0]} s={[w, 0.42, 0.85]} m={m} />
      <B p={[0, 0.42, -0.33]} s={[w, 0.5, 0.22]} m={m} />
      <B p={[-w / 2 + 0.1, 0.42, 0]} s={[0.2, 0.25, 0.85]} m={m} />
      <B p={[w / 2 - 0.1, 0.42, 0]} s={[0.2, 0.25, 0.85]} m={m} />
    </group>
  );
}

export function Beanbag({ p, m }: { p: V3; m: THREE.Material }) {
  return (
    <mesh position={[p[0], p[1] + 0.22, p[2]]} scale={[1, 0.6, 1]} material={m} castShadow>
      <sphereGeometry args={[0.42, 14, 10]} />
    </mesh>
  );
}

export function WallScreen({ p, ry = 0, bars = ['#7FB2D9', '#F2C46D', '#9FD3B5', '#E58A7A'] }: { p: V3; ry?: number; bars?: string[] }) {
  return (
    <group position={p} rotation-y={ry}>
      <B p={[0, 0, 0]} s={[1.9, 1.05, 0.06]} m={M.screen} />
      {bars.map((c, i) => (
        <mesh key={i} position={[-0.6 + i * 0.4, 0.22 + (0.15 + ((i * 37) % 5) * 0.08) / 2, 0.035]}>
          <planeGeometry args={[0.24, 0.15 + ((i * 37) % 5) * 0.08]} />
          <meshBasicMaterial color={c} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export function Whiteboard({ p, color }: { p: V3; color: string }) {
  return (
    <group position={p}>
      <B p={[0, 0, 0]} s={[1.8, 0.95, 0.05]} m={M.white} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i} position={[-0.6 + (i % 3) * 0.6, 0.3 + Math.floor(i / 3) * 0.36, 0.03]}>
          <planeGeometry args={[0.32, 0.24]} />
          <meshBasicMaterial color={i % 2 ? color : '#F7E39A'} />
        </mesh>
      ))}
    </group>
  );
}
