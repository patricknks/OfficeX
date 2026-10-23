import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';
import { useT } from '../i18n';
import { clock } from '../util';
import { M } from './materials';
import { livePos } from './Avatar';
import { PROJECTOR } from './floorplan';
import { drawLiveChart } from './liveChart';

const SCREEN_W = PROJECTOR.width;
const SCREEN_H = PROJECTOR.height;

/** A pull-down projector screen beside the building, showing the latest image an agent presented. */
export function Projector() {
  const t = useT();
  const items = useStore((s) => s.projector);
  const agents = useStore((s) => s.agents);
  const openViewer = useStore((s) => s.openViewer);
  const labels = useStore((s) => s.labels);
  const latest = items[items.length - 1];
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const [hover, setHover] = useState(false);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  const changedAt = useRef(0);

  const isLive = latest?.kind === 'live';
  // live chart: a canvas texture redrawn a few times per second from the store's data
  const live = useMemo(() => {
    if (!isLive) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = Math.round((1024 * SCREEN_H) / SCREEN_W);
    const tx = new THREE.CanvasTexture(canvas);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 4;
    return { canvas, tx, last: 0 };
  }, [isLive, latest?.id]);
  useEffect(() => () => live?.tx.dispose(), [live]);

  useEffect(() => {
    if (!latest || latest.kind === 'live') return;
    let alive = true;
    new THREE.TextureLoader().load(latest.src, (tx) => {
      if (!alive) return;
      tx.colorSpace = THREE.SRGBColorSpace;
      tx.anisotropy = 4;
      setTex(tx);
      changedAt.current = performance.now();
    });
    return () => {
      alive = false;
    };
  }, [latest?.id, latest?.src]);

  // image fitted inside the screen, letterboxed
  const imgSize = useMemo(() => {
    const img = tex?.image as { width: number; height: number } | undefined;
    if (!img) return [SCREEN_W * 0.94, SCREEN_H * 0.9] as const;
    const a = img.width / img.height;
    const maxW = SCREEN_W * 0.94;
    const maxH = SCREEN_H * 0.9;
    return a > maxW / maxH ? ([maxW, maxW / a] as const) : ([maxH * a, maxH] as const);
  }, [tex]);

  const center = useMemo(() => new THREE.Vector3(PROJECTOR.x, PROJECTOR.base + SCREEN_H / 2 - 0.46, PROJECTOR.z), []);
  useEffect(() => {
    livePos.set('projector', center);
    return () => void livePos.delete('projector');
  }, [center]);

  useFrame(() => {
    if (live && latest) {
      const now = performance.now();
      if (now - live.last > 250) {
        live.last = now;
        const ctx = live.canvas.getContext('2d');
        if (ctx) {
          drawLiveChart(ctx, live.canvas.width, live.canvas.height, latest, useStore.getState().live[latest.id]);
          live.tx.needsUpdate = true;
        }
      }
    }
    if (!glow.current) return;
    const k = Math.max(0, 1 - (performance.now() - changedAt.current) / 2500);
    glow.current.opacity = hover ? 0.9 : k * 0.9;
  });

  const presenter = latest ? agents[`${latest.teamId}/${latest.agentId}`] : undefined;

  return (
    <group position={[PROJECTOR.x, -0.46, PROJECTOR.z]} rotation-y={PROJECTOR.ry}>
      {/* tripod stand */}
      {[-SCREEN_W / 2 + 0.3, SCREEN_W / 2 - 0.3].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, (PROJECTOR.base + SCREEN_H + 0.3) / 2, -0.08]} material={M.charcoal} castShadow>
            <boxGeometry args={[0.1, PROJECTOR.base + SCREEN_H + 0.3, 0.1]} />
          </mesh>
          <mesh position={[0, 0.04, -0.08]} material={M.charcoal}>
            <boxGeometry args={[0.9, 0.08, 0.9]} />
          </mesh>
        </group>
      ))}
      {/* roller at the top */}
      <mesh position={[0, PROJECTOR.base + SCREEN_H + 0.18, 0]} rotation-z={Math.PI / 2} material={M.charcoal} castShadow>
        <cylinderGeometry args={[0.16, 0.16, SCREEN_W + 0.4, 16]} />
      </mesh>

      <group
        position={[0, PROJECTOR.base + SCREEN_H / 2, 0]}
        onClick={(e) => {
          e.stopPropagation();
          openViewer();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = 'zoom-in';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
      >
        {/* glow border when a new image arrives or on hover */}
        <mesh position={[0, 0, -0.02]}>
          <planeGeometry args={[SCREEN_W + 0.35, SCREEN_H + 0.35]} />
          <meshBasicMaterial ref={glow} color="#9fdcff" transparent opacity={0} toneMapped={false} />
        </mesh>
        <mesh castShadow>
          <boxGeometry args={[SCREEN_W, SCREEN_H, 0.04]} />
          <meshStandardMaterial color="#F7F6F2" roughness={0.9} />
        </mesh>
        {live ? (
          <mesh position={[0, 0, 0.025]}>
            <planeGeometry args={[SCREEN_W * 0.96, SCREEN_H * 0.94]} />
            <meshBasicMaterial map={live.tx} toneMapped={false} />
          </mesh>
        ) : tex ? (
          <mesh position={[0, 0, 0.025]}>
            <planeGeometry args={[imgSize[0], imgSize[1]]} />
            <meshBasicMaterial map={tex} toneMapped={false} />
          </mesh>
        ) : (
          labels !== 'off' && (
            <Html center transform={false} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
              <p className="projector-empty">{t('projector.empty')}</p>
            </Html>
          )
        )}
      </group>

      {labels !== 'off' && (
        <Html position={[0, PROJECTOR.base + SCREEN_H + 0.75, 0]} center zIndexRange={[10, 0]}>
          <button className="room-label is-link projector-label" onClick={() => openViewer()} disabled={!latest}>
            <span className="projector-label__icon" aria-hidden />
            {t('projector.label')}
            {latest && (
              <span className="room-label__state">
                {latest.title}, {presenter?.name ?? latest.agentId} {clock(latest.ts)}
              </span>
            )}
          </button>
        </Html>
      )}
    </group>
  );
}
