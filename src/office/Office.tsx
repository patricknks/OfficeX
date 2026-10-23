import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { agentKey, placeOf, shownStatus, useStore, type Flight } from '../store';
import { MODELS, OFFICE_ID, type Agent, type Team } from '../types';
import { useT } from '../i18n';
import { Floor, Ground, Stairs } from './Building';
import { Desk } from './Furniture';
import { Avatar, livePos, type AvatarTarget } from './Avatar';
import {
  FLOOR_D,
  FLOOR_RISE,
  FLOOR_W,
  OWNER_C,
  deskSpot,
  floorCount,
  floorOrigin,
  loungeSeat,
  meetingSeat,
  seatAtDesk,
  slotX,
  teamSlot,
  PROJECTOR,
  SECRETARY_DESK,
} from './floorplan';
import { Projector } from './Projector';

const FLIGHT_MS = 1600;
const VIEW_DIR = new THREE.Vector3(0.62, 0.82, 1).normalize();

/** A message in transit: a glowing pellet arcing between two live avatar positions. */
function MessageFlight({ flight }: { flight: Flight }) {
  const head = useRef<THREE.Mesh>(null);
  const trail = useRef<THREE.Mesh[]>([]);
  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);
  const mid = useMemo(() => new THREE.Vector3(), []);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(a, mid, b), [a, b, mid]);

  useFrame(() => {
    const k = (performance.now() - flight.start) / FLIGHT_MS;
    const pa = livePos.get(flight.from);
    const pb = livePos.get(flight.to);
    const visible = k >= 0 && k <= 1 && !!pa && !!pb;
    if (visible) {
      a.copy(pa!);
      b.copy(pb!);
      mid.copy(a).lerp(b, 0.5);
      mid.y += 1.4 + a.distanceTo(b) * 0.15;
    }
    const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
    if (head.current) {
      head.current.visible = visible;
      if (visible) head.current.position.copy(curve.getPoint(ease(k)));
    }
    trail.current.forEach((m, i) => {
      const kk = k - (i + 1) * 0.035;
      m.visible = visible && kk > 0;
      if (m.visible) m.position.copy(curve.getPoint(ease(kk)));
    });
  });

  return (
    <group>
      <mesh ref={head}>
        <sphereGeometry args={[0.11, 14, 14]} />
        <meshBasicMaterial color={flight.color} toneMapped={false} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i} ref={(m) => m && (trail.current[i] = m)}>
          <sphereGeometry args={[0.085 - i * 0.011, 10, 10]} />
          <meshBasicMaterial color={flight.color} transparent opacity={0.55 - i * 0.08} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** The owner's presence: a glowing orb over the desk on the ground floor. */
function OwnerOrb() {
  const ring = useRef<THREE.Mesh>(null);
  const flights = useStore((s) => s.flights);
  const busy = flights.some((f) => (f.from === 'ceo' || f.to === 'ceo') && performance.now() - f.start < FLIGHT_MS);
  const p: [number, number, number] = [OWNER_C[0], 1.35, OWNER_C[1] - 0.2];
  useEffect(() => {
    livePos.set('ceo', new THREE.Vector3(...p));
    return () => void livePos.delete('ceo');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.rotation.z = clock.elapsedTime * 0.7;
  });
  return (
    <group position={p}>
      <mesh ref={ring}>
        <torusGeometry args={[0.3, 0.025, 8, 40, Math.PI * 1.6]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.13, 18, 18]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={busy ? 1.4 : 0.45} />
      </mesh>
    </group>
  );
}

function useLayout() {
  const teams = useStore((s) => s.teams);
  const agents = useStore((s) => s.agents);
  const claude = useStore((s) => s.claude);
  return useMemo(() => {
    const floors = floorCount(teams.length);
    const byTeam = new Map<string, Agent[]>();
    Object.values(agents).forEach((a) => {
      const l = byTeam.get(a.teamId) ?? [];
      l.push(a);
      byTeam.set(a.teamId, l);
    });
    byTeam.forEach((l) => l.sort((a, b) => (a.role === 'manager' ? -1 : b.role === 'manager' ? 1 : 0)));

    const loungeCount = new Map<number, number>();
    const items: { a: Agent; team: Team | undefined; floor: number; target: AvatarTarget; desk: [number, number]; atDesk: boolean }[] = [];
    teams.forEach((team, ti) => {
      const { floor, slot } = teamSlot(ti);
      const origin = floorOrigin(floor);
      (byTeam.get(team.id) ?? []).forEach((a, i) => {
        const desk = deskSpot(slot, i);
        const place = placeOf(a, team, claude);
        let target: AvatarTarget;
        if (place === 'desk') target = { local: seatAtDesk(desk), face: 0, room: { kind: 'team', slot }, origin };
        else if (place === 'meeting') {
          const s = meetingSeat(i);
          target = { local: s.p, face: s.face, room: { kind: 'meeting' }, origin };
        } else {
          const n = loungeCount.get(floor) ?? 0;
          loungeCount.set(floor, n + 1);
          const s = loungeSeat(n);
          target = { local: s.p, face: s.face, room: { kind: 'lounge' }, origin };
        }
        items.push({ a, team, floor, target, desk, atDesk: place === 'desk' });
      });
    });
    // front office: the secretary sits next to the owner on the ground floor
    (byTeam.get(OFFICE_ID) ?? []).forEach((a, i) => {
      const origin = floorOrigin(0);
      const desk: [number, number] = [SECRETARY_DESK[0], SECRETARY_DESK[1] + i * 1.3];
      const atDesk = placeOf(a, undefined, claude) === 'desk';
      let target: AvatarTarget;
      if (atDesk) target = { local: seatAtDesk(desk), face: 0, room: { kind: 'owner' }, origin };
      else {
        const n = loungeCount.get(0) ?? 0;
        loungeCount.set(0, n + 1);
        const s = loungeSeat(n);
        target = { local: s.p, face: s.face, room: { kind: 'lounge' }, origin };
      }
      items.push({ a, team: undefined, floor: 0, target, desk, atDesk });
    });
    return { floors, items };
  }, [teams, agents, claude]);
}

/** Moves the camera to whatever the store asks to focus on. User drags cancel the move. */
function CameraRig({ controls }: { controls: React.RefObject<OrbitControlsImpl> }) {
  const { camera, size } = useThree();
  const focus = useStore((s) => s.focus);
  const floorView = useStore((s) => s.floorView);
  const teams = useStore((s) => s.teams);
  const anim = useRef<{ target: THREE.Vector3; zoom: number } | null>(null);
  const floors = floorCount(teams.length);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const stop = () => (anim.current = null);
    c.addEventListener('start', stop);
    const onZoom = (e: Event) => {
      const cam = camera as THREE.OrthographicCamera;
      anim.current = { target: c.target.clone(), zoom: Math.min(140, Math.max(10, cam.zoom * (e as CustomEvent<number>).detail)) };
    };
    window.addEventListener('ct:zoom', onZoom);
    return () => {
      c.removeEventListener('start', stop);
      window.removeEventListener('ct:zoom', onZoom);
    };
  }, [controls, camera]);

  useEffect(() => {
    /** Zoom and target so that every given world point is on screen, below the top overlay. */
    const fit = (points: THREE.Vector3[]) => {
      const m = new THREE.Matrix4().lookAt(VIEW_DIR.clone().multiplyScalar(80), new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
      const inv = m.clone().invert();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      points.forEach((p) => {
        const v = p.clone().applyMatrix4(inv);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      });
      const topPad = 70; // room chips / banner sit over the top of the canvas
      const bottomPad = 60; // toolbar
      const zoom = Math.min(size.width / ((maxX - minX) * 1.06), (size.height - topPad - bottomPad) / ((maxY - minY) * 1.04));
      // camera-space centre, nudged so the content sits in the free area between the overlays
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2 + (topPad - bottomPad) / 2 / zoom;
      anim.current = { target: new THREE.Vector3(cx, cy, 0).applyMatrix4(m), zoom };
    };
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
      const out: THREE.Vector3[] = [];
      for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push(new THREE.Vector3(x, y, z));
      return out;
    };
    const projectorPts = () => {
      const c = Math.cos(PROJECTOR.ry);
      const sn = Math.sin(PROJECTOR.ry);
      const hw = PROJECTOR.width / 2 + 1.5; // room for the label
      return [-hw, hw].flatMap((dx) =>
        [0, PROJECTOR.base + PROJECTOR.height + 1.2].map((y) => new THREE.Vector3(PROJECTOR.x + dx * c, y, PROJECTOR.z - dx * sn)),
      );
    };
    if (focus.kind === 'building') {
      const list = floorView === 'all' ? Array.from({ length: floors }, (_, i) => i) : [floorView];
      const pts = list.flatMap((f) => {
        const o = floorOrigin(f);
        return box(o[0] - FLOOR_W / 2 - 1.5, o[0] + FLOOR_W / 2 + 1.5, o[1] - 0.5, o[1] + 2.8, o[2] - FLOOR_D / 2, o[2] + FLOOR_D / 2 + 0.3);
      });
      if (floorView === 'all' || floorView === 0) pts.push(...projectorPts());
      fit(pts);
    } else if (focus.kind === 'team') {
      const i = teams.findIndex((t) => t.id === focus.teamId);
      if (i < 0) return;
      const { floor, slot } = teamSlot(i);
      const o = floorOrigin(floor);
      const x = o[0] + slotX(slot);
      fit(box(x - 4.2, x + 4.2, o[1], o[1] + 2.6, o[2] - 6.2, o[2] + 1.2));
    } else if (focus.kind === 'agent') {
      const p = livePos.get(focus.key);
      if (p) fit(box(p.x - 2.6, p.x + 2.6, p.y - 1.2, p.y + 1, p.z - 2, p.z + 2));
    } else if (focus.kind === 'projector') {
      fit(projectorPts());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.n, floorView, floors, size.width, size.height]);

  useFrame((_, dt) => {
    const c = controls.current;
    const a = anim.current;
    if (!c || !a) return;
    const cam = camera as THREE.OrthographicCamera;
    const k = 1 - Math.exp(-Math.min(dt, 0.5) * 7); // frame-rate independent easing
    const delta = a.target.clone().sub(c.target).multiplyScalar(k);
    c.target.add(delta);
    cam.position.add(delta);
    cam.zoom += (a.zoom - cam.zoom) * k;
    cam.updateProjectionMatrix();
    c.update();
    if (delta.length() < 0.002 && Math.abs(a.zoom - cam.zoom) < 0.05) anim.current = null;
  });
  return null;
}

function Scene({ controls }: { controls: React.RefObject<OrbitControlsImpl> }) {
  const t = useT();
  const teams = useStore((s) => s.teams);
  const claude = useStore((s) => s.claude);
  const flights = useStore((s) => s.flights);
  const labels = useStore((s) => s.labels);
  const floorView = useStore((s) => s.floorView);
  const selectedAgentKey = useStore((s) => s.selectedAgentKey);
  const selectAgent = useStore((s) => s.selectAgent);
  const selectTeam = useStore((s) => s.selectTeam);
  const { floors, items } = useLayout();
  const visible = (f: number) => floorView === 'all' || floorView === f;

  const openNewTeam = () => window.dispatchEvent(new CustomEvent('ct:new-team'));
  const span = floors * FLOOR_RISE + 30;

  return (
    <>
      <color attach="background" args={['#22303C']} />
      <hemisphereLight args={['#F4F7FA', '#45525E', 1.05]} />
      <directionalLight
        position={[14, 22, 12]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-far={120}
        shadow-bias={-0.0005}
      />
      <Ground floors={floors} />
      <group onPointerMissed={() => selectAgent(null)}>
        {Array.from({ length: floors }).map((_, f) =>
          visible(f) ? (
            <group key={f}>
              <Floor
                floor={f}
                teams={teams.slice(f * 3, f * 3 + 3)}
                labels={labels}
                onSelectTeam={(id) => selectTeam(id)}
                onCreateTeam={openNewTeam}
                showLabel={floors > 1 && labels !== 'off'}
              />
              {floorView === 'all' && f < floors - 1 && <Stairs floor={f} />}
            </group>
          ) : null,
        )}
        {visible(0) && <OwnerOrb />}
        {(floorView === 'all' || floorView === 0) && <Projector />}
        {items.map(({ a, team, floor, desk, atDesk }) =>
          visible(floor) ? (
            <Desk
              key={'d' + agentKey(a.teamId, a.id)}
              p={[floorOrigin(floor)[0] + desk[0], floorOrigin(floor)[1], floorOrigin(floor)[2] + desk[1]]}
              color={a.color}
              status={shownStatus(a, team, claude)}
              present={atDesk}
            />
          ) : null,
        )}
        {items.map(({ a, team, floor, target }) => {
          if (!visible(floor)) return null;
          const k = agentKey(a.teamId, a.id);
          const st = shownStatus(a, team, claude);
          const statusText = team?.meeting && st === 'idle' ? t('status.meeting') : t(`status.${st}` as never);
          return (
            <Avatar
              key={k}
              id={k}
              color={a.color}
              role={a.role}
              name={a.name}
              title={a.roleTitle}
              model={a.runModel ? `${MODELS.find((m) => m.id === a.runModel)?.label ?? a.runModel} ▸` : MODELS.find((m) => m.id === a.model)?.label ?? ''}
              status={st}
              statusText={statusText}
              walkingText={t('status.walking')}
              activity={a.activity}
              target={target}
              spawn={!!a.hiredAt && Date.now() - a.hiredAt < 4000}
              labels={labels}
              selected={selectedAgentKey === k}
              onSelect={() => selectAgent(k)}
            />
          );
        })}
        {flights.map((f) => (
          <MessageFlight key={f.id} flight={f} />
        ))}
      </group>
      <CameraRig controls={controls} />
    </>
  );
}

export function Office() {
  const controls = useRef<OrbitControlsImpl>(null);
  const pos = VIEW_DIR.clone().multiplyScalar(80);
  return (
    <Canvas shadows dpr={[1, 1.75]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <OrthographicCamera makeDefault position={[pos.x, pos.y, pos.z]} zoom={28} near={-200} far={400} />
      <Scene controls={controls} />
      <OrbitControls
        ref={controls}
        target={[0, 0, 0]}
        enablePan
        screenSpacePanning
        minZoom={10}
        maxZoom={140}
        minPolarAngle={0.45}
        maxPolarAngle={1.2}
        minAzimuthAngle={-0.5}
        maxAzimuthAngle={1.25}
        enableDamping
        dampingFactor={0.12}
      />
    </Canvas>
  );
}

/** Imperative zoom for the toolbar buttons. */
export function zoomBy(factor: number) {
  window.dispatchEvent(new CustomEvent('ct:zoom', { detail: factor }));
}
