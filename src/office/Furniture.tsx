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
      <mesh position={[0, 0.36, 0]} material={M.soil}>
        <cylinderGeometry args={[0.14, 0.14, 0.02, 12]} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = i * 1.26;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.1, 0.62, Math.sin(a) * 0.1]} rotation={[-Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45]} material={i % 2 ? M.leaf : M.plant} castShadow>
            <coneGeometry args={[0.11, 0.5, 6]} />
          </mesh>
        );
      })}
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
  // open bookcase: back panel, two sides, three boards, a row of books per board, a plant on top
  const rows = [0.06, 0.52, 0.98];
  return (
    <group position={p} rotation-y={ry}>
      <B p={[0, 0, -0.15]} s={[w, 1.5, 0.05]} m={M.wood} />
      <B p={[-w / 2 + 0.025, 0, 0]} s={[0.05, 1.5, 0.35]} m={M.wood} shadow={false} />
      <B p={[w / 2 - 0.025, 0, 0]} s={[0.05, 1.5, 0.35]} m={M.wood} shadow={false} />
      <B p={[0, 1.47, 0]} s={[w, 0.04, 0.35]} m={M.wood} shadow={false} />
      {rows.map((y, row) => (
        <group key={row}>
          <B p={[0, y, 0]} s={[w - 0.1, 0.03, 0.33]} m={M.deskTop} shadow={false} />
          {Array.from({ length: Math.max(4, Math.round(w * 6)) }).map((_, i, arr) => {
            const bw = (w - 0.3) / arr.length - 0.015;
            const h = 0.26 + (((i * 7 + row * 3) % 5) * 0.025);
            return <B key={i} p={[-w / 2 + 0.15 + bw / 2 + i * (bw + 0.015), y + 0.03, 0.02]} s={[bw, h, 0.26]} m={M.books[(i * 2 + row) % M.books.length]} shadow={false} />;
          })}
        </group>
      ))}
      <group position={[w / 2 - 0.3, 1.49, 0]}>
        <mesh position={[0, 0.1, 0]} material={M.soil} castShadow>
          <cylinderGeometry args={[0.11, 0.08, 0.2, 10]} />
        </mesh>
        <mesh position={[0, 0.33, 0]} material={M.plant} castShadow>
          <sphereGeometry args={[0.18, 10, 8]} />
        </mesh>
      </group>
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
      {/* top, underside strip, four steel legs, a drawer pedestal with handles */}
      <B p={[0, 0.72, 0]} s={[1.7, 0.06, 0.85]} m={M.deskTop} />
      <B p={[0, 0.68, 0]} s={[1.66, 0.04, 0.8]} m={M.deskEdge} shadow={false} />
      {[
        [-0.77, 0.36],
        [0.77, 0.36],
        [-0.77, -0.36],
        [0.77, -0.36],
      ].map(([x, z], i) => (
        <B key={i} p={[x, 0, z]} s={[0.06, 0.7, 0.06]} m={M.steel} shadow={false} />
      ))}
      <B p={[0.58, 0, -0.05]} s={[0.4, 0.5, 0.6]} m={M.drawer} />
      {[0, 1, 2].map((i) => (
        <B key={i} p={[0.58, 0.1 + i * 0.15, 0.26]} s={[0.3, 0.02, 0.02]} m={M.steel} shadow={false} />
      ))}
      {/* monitor on a stand, keyboard, mouse */}
      <group position={[0, 0.75, -0.18]}>
        <B p={[0, 0, 0]} s={[0.3, 0.02, 0.18]} m={M.charcoal} shadow={false} />
        <B p={[0, 0.02, 0]} s={[0.05, 0.1, 0.05]} m={M.charcoal} shadow={false} />
        <B p={[0, 0.12, 0]} s={[0.78, 0.46, 0.04]} m={M.charcoal} />
        <mesh position={[0, 0.35, 0.025]}>
          <boxGeometry args={[0.7, 0.36, 0.005]} />
          <meshStandardMaterial ref={lamp} color={color} emissive={color} emissiveIntensity={0.05} toneMapped={false} />
        </mesh>
      </group>
      <B p={[0, 0.75, 0.2]} s={[0.4, 0.015, 0.14]} m={M.keys} shadow={false} />
      <B p={[0.32, 0.75, 0.2]} s={[0.07, 0.015, 0.11]} m={M.keys} shadow={false} />
      {/* mug and lamp */}
      <mesh position={[-0.6, 0.81, 0.08]} material={M.mug} castShadow>
        <cylinderGeometry args={[0.05, 0.04, 0.12, 10]} />
      </mesh>
      <mesh position={[-0.6, 0.87, 0.08]} material={M.coffee}>
        <cylinderGeometry args={[0.04, 0.04, 0.01, 10]} />
      </mesh>
      <mesh position={[-0.62, 0.76, -0.28]} material={M.charcoal}>
        <cylinderGeometry args={[0.06, 0.08, 0.02, 10]} />
      </mesh>
      <mesh position={[-0.56, 0.95, -0.28]} rotation-z={0.3} material={M.charcoal}>
        <cylinderGeometry args={[0.012, 0.012, 0.4, 6]} />
      </mesh>
      <mesh position={[-0.46, 1.12, -0.28]} material={M.lampShade} castShadow>
        <coneGeometry args={[0.08, 0.1, 10, 1, true]} />
      </mesh>
      {/* chair: seat, back with a team-coloured pad, armrests, gas lift, five-star base */}
      <group position={[0, 0, -0.72]}>
        <B p={[0, 0.42, 0]} s={[0.5, 0.08, 0.5]} m={M.chairDark} shadow={false} />
        <B p={[0, 0.5, -0.24]} s={[0.5, 0.55, 0.07]} m={M.chairDark} shadow={false} />
        <mesh position={[0, 0.85, -0.2]}>
          <boxGeometry args={[0.4, 0.3, 0.02]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
        <B p={[-0.26, 0.58, -0.08]} s={[0.06, 0.04, 0.3]} m={M.chairDark} shadow={false} />
        <B p={[0.26, 0.58, -0.08]} s={[0.06, 0.04, 0.3]} m={M.chairDark} shadow={false} />
        <mesh position={[0, 0.22, 0]} material={M.steel}>
          <cylinderGeometry args={[0.03, 0.03, 0.4, 8]} />
        </mesh>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i * Math.PI * 2) / 5;
          return <B key={i} p={[Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15]} s={[0.3, 0.03, 0.05]} m={M.steel} ry={-a} shadow={false} />;
        })}
      </group>
    </group>
  );
}

export function Sofa({ p, ry = 0, w = 3, m }: { p: V3; ry?: number; w?: number; m: THREE.Material }) {
  const seats = Math.max(2, Math.round(w / 0.9));
  const sw = (w - 0.4) / seats;
  return (
    <group position={p} rotation-y={ry}>
      <B p={[0, 0.08, 0]} s={[w, 0.3, 0.85]} m={m} />
      <B p={[0, 0.38, -0.33]} s={[w, 0.5, 0.22]} m={m} />
      <B p={[-w / 2 + 0.1, 0.38, 0]} s={[0.2, 0.3, 0.85]} m={m} />
      <B p={[w / 2 - 0.1, 0.38, 0]} s={[0.2, 0.3, 0.85]} m={m} />
      {Array.from({ length: seats }).map((_, i) => (
        <B key={i} p={[-w / 2 + 0.2 + sw / 2 + i * sw, 0.38, 0.03]} s={[sw - 0.04, 0.12, 0.66]} m={M.cushionA} shadow={false} />
      ))}
      <B p={[-w / 2 + 0.45, 0.5, -0.12]} s={[0.36, 0.36, 0.1]} m={M.cushionB} ry={0.3} shadow={false} />
      <B p={[w / 2 - 0.5, 0.5, -0.12]} s={[0.36, 0.36, 0.1]} m={M.cushionC} ry={-0.2} shadow={false} />
      {[-1, 1].map((sx) => [-1, 1].map((sz) => <B key={`${sx}${sz}`} p={[sx * (w / 2 - 0.15), 0, sz * 0.3]} s={[0.06, 0.08, 0.06]} m={M.woodDark} shadow={false} />))}
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
