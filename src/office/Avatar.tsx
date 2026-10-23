import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { RoleKind, ShownStatus } from '../types';
import { BodyProps, HeadProps } from './RoleProps';
import type { LabelMode } from '../store';
import { CORRIDOR_Z, pathBetween, type RoomRef } from './floorplan';

/** Live world positions of every avatar head, read by the message flights. */
export const livePos = new Map<string, THREE.Vector3>();

export interface AvatarTarget {
  local: [number, number]; // floor-local x/z
  face: number; // y rotation when arrived
  room: RoomRef;
  origin: [number, number, number]; // floor origin in world space
}

interface Props {
  id: string;
  color: string;
  role: RoleKind;
  name: string;
  title: string;
  model: string;
  status: ShownStatus;
  statusText: string;
  walkingText: string;
  activity: string;
  target: AvatarTarget;
  spawn: boolean;
  labels: LabelMode;
  selected: boolean;
  onSelect: () => void;
}

const SPEED = 2.8;
const SLEEPY: ShownStatus[] = ['offline', 'paused', 'team_paused'];
const GREY = '#8E99A3';

export function Avatar({ id, color, role, name, title, model, status, statusText, walkingText, activity, target, spawn, labels, selected, onSelect }: Props) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const dots = useRef<THREE.Group>(null);
  const zzz = useRef<THREE.Group>(null);
  const [walking, setWalking] = useState(false);
  const [hover, setHover] = useState(false);
  const [near, setNear] = useState(false);
  const camera = useThree((s) => s.camera);

  const pos = useRef(new THREE.Vector2(...target.local));
  const queue = useRef<[number, number][]>([]);
  const room = useRef<RoomRef>(target.room);
  const yaw = useRef(target.face);
  const seed = useMemo(() => Math.random() * 10, []);
  const sleepy = SLEEPY.includes(status);
  const tone = status === 'offline' ? GREY : color;

  // first appearance: new hires walk in from the stairs end of the corridor
  useEffect(() => {
    if (spawn) {
      pos.current.set(10.2, CORRIDOR_Z);
      queue.current = pathBetween([10.2, CORRIDOR_Z], { kind: 'lounge' }, target.local, target.room).slice(2);
      setWalking(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tKey = `${target.room.kind}-${'slot' in target.room ? target.room.slot : ''}-${target.local[0].toFixed(2)}-${target.local[1].toFixed(2)}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    queue.current = pathBetween([pos.current.x, pos.current.y], room.current, target.local, target.room);
    room.current = target.room;
    setWalking(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tKey]);

  useFrame(({ clock }, dt) => {
    const isNear = camera.zoom > 46;
    if (isNear !== near) setNear(isNear);
    const t = clock.elapsedTime + seed;
    const g = group.current;
    if (!g) return;
    let moving = false;
    if (queue.current.length) {
      const [nx, nz] = queue.current[0];
      const dx = nx - pos.current.x;
      const dz = nz - pos.current.y;
      const d = Math.hypot(dx, dz);
      const step = SPEED * Math.min(dt, 0.25);
      if (d <= step) {
        pos.current.set(nx, nz);
        queue.current.shift();
        if (!queue.current.length) setWalking(false);
      } else {
        pos.current.x += (dx / d) * step;
        pos.current.y += (dz / d) * step;
        const want = Math.atan2(dx, dz);
        yaw.current += angleDelta(yaw.current, want) * Math.min(1, dt * 12);
        moving = true;
      }
    } else {
      yaw.current += angleDelta(yaw.current, target.face) * Math.min(1, dt * 6);
    }
    g.position.set(target.origin[0] + pos.current.x, target.origin[1], target.origin[2] + pos.current.y);
    g.rotation.y = yaw.current;

    if (body.current) {
      let y = 0;
      if (moving) y = Math.abs(Math.sin(t * 11)) * 0.08;
      else if (status === 'tool') y = Math.abs(Math.sin(t * 9)) * 0.03;
      else if (status === 'messaging') y = Math.abs(Math.sin(t * 6)) * 0.09;
      else if (!sleepy) y = Math.sin(t * 1.4) * 0.01;
      body.current.position.y = y;
    }
    if (head.current) {
      head.current.rotation.z = !moving && status === 'thinking' ? Math.sin(t * 1.6) * 0.18 : sleepy && !moving ? 0.35 : 0;
      head.current.rotation.x = !moving && status === 'tool' ? 0.28 : sleepy && !moving ? 0.25 : 0;
    }
    if (dots.current) {
      dots.current.visible = !moving && status === 'thinking';
      dots.current.rotation.y = t * 2;
    }
    if (zzz.current) {
      zzz.current.visible = sleepy && !moving;
      zzz.current.children.forEach((c, i) => {
        const k = (t * 0.5 + i / 3) % 1;
        c.position.set(0.15 + k * 0.25, 0.3 + k * 0.5, 0);
        c.scale.setScalar(0.4 + k * 0.6);
      });
    }
    let lp = livePos.get(id);
    if (!lp) livePos.set(id, (lp = new THREE.Vector3()));
    lp.set(g.position.x, g.position.y + 1.05, g.position.z);
  });

  useEffect(() => () => void livePos.delete(id), [id]);

  const shortAct = activity.length > 40 ? activity.slice(0, 39) + '…' : activity;
  const detail = labels === 'full' && (near || selected || hover);
  const showActivity = detail && !sleepy && !!activity && status !== 'idle';
  const showTag = labels !== 'off' && (near || selected || hover || !sleepy);

  return (
    <group ref={group}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} visible={selected || hover}>
        <ringGeometry args={[0.42, 0.5, 36]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.95 : 0.5} />
      </mesh>
      <group
        scale={0.72}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
      >
        <group ref={body}>
          <mesh position={[0, 0.82, 0]} castShadow>
            <capsuleGeometry args={[0.26, 0.32, 6, 14]} />
            <meshStandardMaterial color={tone} roughness={0.55} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.34, 0.85, 0]} rotation-z={s * 0.15} castShadow>
              <capsuleGeometry args={[0.06, 0.3, 4, 8]} />
              <meshStandardMaterial color={tone} roughness={0.55} />
            </mesh>
          ))}
          <BodyProps role={role} color={tone} />
          <group ref={head} position={[0, 1.36, 0]}>
            <RoundedBox args={[0.46, 0.36, 0.38]} radius={0.1} castShadow>
              <meshStandardMaterial color="#F4F6F7" roughness={0.6} />
            </RoundedBox>
            <RoundedBox args={[0.36, 0.13, 0.05]} radius={0.04} position={[0, 0.01, 0.18]}>
              <meshStandardMaterial color="#26313B" roughness={0.3} />
            </RoundedBox>
            {[-0.08, 0.08].map((x) => (
              <mesh key={x} position={[x, 0.015, 0.21]} scale={[1, sleepy ? 0.25 : 1, 1]}>
                <sphereGeometry args={[0.025, 10, 10]} />
                <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={sleepy ? 0.2 : 1.2} toneMapped={false} />
              </mesh>
            ))}
            <mesh position={[0, 0.26, 0]}>
              <cylinderGeometry args={[0.012, 0.012, 0.16, 6]} />
              <meshStandardMaterial color="#9AA6B0" />
            </mesh>
            <mesh position={[0, 0.36, 0]}>
              <sphereGeometry args={[0.04, 12, 12]} />
              <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={sleepy ? 0 : 0.6} />
            </mesh>
            <HeadProps role={role} color={tone} />
            <group ref={dots} position={[0, 0.1, 0]}>
              {[0, 1, 2].map((i) => (
                <mesh key={i} position={[Math.cos((i * Math.PI * 2) / 3) * 0.38, 0.12, Math.sin((i * Math.PI * 2) / 3) * 0.38]}>
                  <sphereGeometry args={[0.035, 8, 8]} />
                  <meshBasicMaterial color={color} />
                </mesh>
              ))}
            </group>
            <group ref={zzz}>
              {[0, 1, 2].map((i) => (
                <mesh key={i}>
                  <torusGeometry args={[0.05, 0.015, 6, 12]} />
                  <meshBasicMaterial color="#DDE6EE" transparent opacity={0.8} />
                </mesh>
              ))}
            </group>
          </group>
        </group>
      </group>

      {showTag && (
        <Html position={[0, 1.55, 0]} center zIndexRange={[30, 11]} style={{ pointerEvents: 'none' }}>
          <div className={`tag tag--${walking ? 'walking' : status}${selected ? ' tag--selected' : ''}${!detail ? ' tag--compact' : ''}`} style={{ ['--c' as string]: color }}>
            <div className="tag__top">
              <span className="tag__name">{name}</span>
              <span className="tag__title">{title}</span>
            </div>
            {detail && (
              <div className="tag__activity">
                <span className="tag__dot" aria-hidden />
                <span className="tag__state">{walking ? walkingText : statusText}</span>
                <span className="tag__model">{model}</span>
                {showActivity && !walking && <span className="tag__text">{shortAct}</span>}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

function angleDelta(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
