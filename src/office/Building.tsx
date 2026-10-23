import { Html } from '@react-three/drei';
import { B, Beanbag, Plant, Rug, Shelf, Sofa, TallPlant, WallScreen, Whiteboard } from './Furniture';
import { M, tint } from './materials';
import { FLOOR_D, FLOOR_RISE, FLOOR_STEP_BACK, FLOOR_W, LOUNGE_C, MEETING_C, OWNER_C, ROOMS_PER_FLOOR, floorOrigin, slotX } from './floorplan';
import type { Team } from '../types';
import type { LabelMode } from '../store';
import { useT } from '../i18n';

const H_TALL = 2.4;
const H_LOW = 0.55;
const H_PART = 0.9;
const T = 0.16;

/** Wall segment from (x1,z1) to (x2,z2), solid up to h, with a glass band above when glassTo > h. */
function Wall({ a, b, h, glassTo = 0 }: { a: [number, number]; b: [number, number]; h: number; glassTo?: number }) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const ry = Math.atan2(-dz, dx);
  const c: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return (
    <group position={[c[0], 0, c[1]]} rotation-y={ry}>
      <B p={[0, 0, 0]} s={[len, h, T]} m={M.wall} />
      <B p={[0, h, 0]} s={[len, 0.04, T + 0.02]} m={M.wallTrim} shadow={false} />
      {glassTo > h && (
        <mesh position={[0, h + (glassTo - h) / 2, 0]} material={M.glass}>
          <boxGeometry args={[len, glassTo - h, 0.04]} />
        </mesh>
      )}
    </group>
  );
}

function RoomLabel({ p, children, onClick, tone }: { p: [number, number, number]; children: React.ReactNode; onClick?: () => void; tone?: string }) {
  return (
    <Html position={p} center zIndexRange={[10, 0]} style={{ pointerEvents: onClick ? 'auto' : 'none' }}>
      <button className={`room-label${onClick ? ' is-link' : ''}`} style={{ ['--c' as string]: tone ?? '#cfd6dc' }} onClick={onClick} tabIndex={onClick ? 0 : -1}>
        {children}
      </button>
    </Html>
  );
}

function TeamRoom({ team, slot, labels, onSelect }: { team: Team; slot: number; labels: LabelMode; onSelect: () => void }) {
  const t = useT();
  const cx = slotX(slot);
  const rug = tint(team.color, 0.25);
  return (
    <group>
      <Rug p={[cx, 0, -3.1]} s={[6.2, 4.6]} m={rug} />
      <Whiteboard p={[cx + 1.9, 0.9, -5.86]} color={team.color} />
      <Shelf p={[cx - 2.45, 0, -5.72]} w={1.3} />
      <Plant p={[cx + 3.0, 0, -5.55]} />
      <Plant p={[cx - 3.05, 0, -0.95]} size={0.8} />
      {labels !== 'off' && (
        <RoomLabel p={[cx, 2.75, -5.9]} onClick={onSelect} tone={team.color}>
          <span className="room-label__dot" />
          {team.name}
          {team.paused && <span className="room-label__state">{t('teams.paused')}</span>}
          {team.meeting && !team.paused && <span className="room-label__state">{t('teams.meeting')}</span>}
        </RoomLabel>
      )}
    </group>
  );
}

function EmptyRoom({ slot, labels, onCreate }: { slot: number; labels: LabelMode; onCreate: () => void }) {
  const t = useT();
  const cx = slotX(slot);
  return (
    <group>
      <mesh position={[cx, 0.014, -3.2]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[6.2, 4.8]} />
        <meshStandardMaterial color="#E2D8C6" roughness={1} />
      </mesh>
      <B p={[cx - 1.6, 0, -4.2]} s={[0.8, 0.5, 0.6]} m={M.wallTrim} />
      <B p={[cx - 1.5, 0.5, -4.2]} s={[0.6, 0.4, 0.5]} m={M.wallTrim} ry={0.2} />
      {labels !== 'off' && (
        <RoomLabel p={[cx, 1.4, -3.2]} onClick={onCreate}>
          {t('room.empty')}, {t('room.emptyCta').toLowerCase()}
        </RoomLabel>
      )}
    </group>
  );
}

function MeetingRoom({ labels }: { labels: LabelMode }) {
  const t = useT();
  const [x, z] = MEETING_C;
  return (
    <group>
      <Rug p={[x, 0, z]} s={[6.2, 4.4]} m={M.rugMeeting} />
      <B p={[x, 0.68, z]} s={[4.4, 0.08, 1.25]} m={M.wood} />
      <B p={[x - 1.6, 0, z]} s={[0.12, 0.68, 0.8]} m={M.woodDark} shadow={false} />
      <B p={[x + 1.6, 0, z]} s={[0.12, 0.68, 0.8]} m={M.woodDark} shadow={false} />
      {[-1.65, -0.55, 0.55, 1.65].flatMap((dx) =>
        [-1, 1].map((sz) => (
          <group key={`${dx}${sz}`} position={[x + dx, 0, z + sz * 1.05]}>
            <B p={[0, 0.3, 0]} s={[0.42, 0.07, 0.42]} m={M.chair} shadow={false} />
            <B p={[0, 0.3, sz * 0.2]} s={[0.42, 0.45, 0.06]} m={M.chair} shadow={false} />
          </group>
        )),
      )}
      <WallScreen p={[-10.38, 0.9, z]} ry={Math.PI / 2} />
      <TallPlant p={[x + 2.8, 0, 5.5]} />
      <Plant p={[x - 2.9, 0, 1.5]} size={0.85} />
      {labels !== 'off' && <RoomLabel p={[x, 1.9, 1.2]}>{t('room.meeting')}</RoomLabel>}
    </group>
  );
}

function Lounge({ labels }: { labels: LabelMode }) {
  const t = useT();
  const [x, z] = LOUNGE_C;
  return (
    <group>
      <Rug p={[x + 0.3, 0, z + 0.4]} s={[5.6, 3.6]} m={M.rugLounge} />
      <Sofa p={[x - 0.5, 0, 1.62]} w={3.2} m={M.sofaBlue} />
      <Sofa p={[10.02, 0, 4.0]} ry={-Math.PI / 2} w={3.0} m={M.sofaRose} />
      <B p={[x + 0.3, 0, z + 0.5]} s={[1.4, 0.36, 0.8]} m={M.wood} />
      <mesh position={[x + 0.1, 0.44, z + 0.45]} material={M.white}>
        <cylinderGeometry args={[0.07, 0.06, 0.14, 10]} />
      </mesh>
      <Beanbag p={[x - 2.2, 0, 4.9]} m={M.beanbagA} />
      <Beanbag p={[x - 1.0, 0, 5.35]} m={M.beanbagB} />
      {/* coffee bar along the left partition */}
      <B p={[3.95, 0, 2.45]} s={[0.6, 0.9, 1.6]} m={M.wood} />
      <B p={[3.95, 0.9, 2.2]} s={[0.4, 0.42, 0.34]} m={M.charcoal} />
      <mesh position={[3.95, 1.0, 2.75]} material={M.white}>
        <cylinderGeometry args={[0.06, 0.05, 0.13, 10]} />
      </mesh>
      <TallPlant p={[10.0, 0, 1.45]} />
      <Plant p={[10.0, 0, 5.65]} />
      <Plant p={[x + 1.4, 0, 5.75]} size={0.8} />
      {labels !== 'off' && <RoomLabel p={[x, 1.9, 1.2]}>{t('room.lounge')}</RoomLabel>}
    </group>
  );
}

function OwnerDesk({ labels }: { labels: LabelMode }) {
  const t = useT();
  const [x, z] = OWNER_C;
  return (
    <group>
      <Rug p={[x, 0, z + 0.2]} s={[5.4, 3.8]} m={M.rugOwner} />
      <B p={[x, 0.72, z - 0.2]} s={[2.2, 0.08, 1.0]} m={M.woodDark} />
      <B p={[x - 0.95, 0, z - 0.2]} s={[0.1, 0.72, 0.9]} m={M.woodDark} shadow={false} />
      <B p={[x + 0.95, 0, z - 0.2]} s={[0.1, 0.72, 0.9]} m={M.woodDark} shadow={false} />
      <B p={[x, 0.36, z + 0.6]} s={[0.6, 0.08, 0.55]} m={M.chair} shadow={false} />
      <B p={[x, 0.44, z + 0.88]} s={[0.6, 0.6, 0.08]} m={M.chair} shadow={false} />
      <Shelf p={[x - 2.3, 0, 5.75]} ry={Math.PI} w={1.6} />
      <TallPlant p={[x + 2.7, 0, 5.5]} />
      <Plant p={[x - 3.0, 0, 1.5]} size={0.8} />
      {labels !== 'off' && <RoomLabel p={[x, 2.6, z - 0.2]}>{t('room.owner')}</RoomLabel>}
    </group>
  );
}

function Pantry({ labels }: { labels: LabelMode }) {
  const t = useT();
  const [x, z] = OWNER_C;
  return (
    <group>
      <Rug p={[x, 0, z + 0.2]} s={[5.4, 3.8]} m={M.rugLounge} />
      <mesh position={[x, 0.72, z]} material={M.wood} castShadow>
        <cylinderGeometry args={[0.8, 0.8, 0.07, 24]} />
      </mesh>
      <B p={[x, 0, z]} s={[0.12, 0.72, 0.12]} m={M.woodDark} shadow={false} />
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        return (
          <mesh key={i} position={[x + Math.cos(a) * 1.15, 0.24, z + Math.sin(a) * 1.15]} material={M.chair} castShadow>
            <cylinderGeometry args={[0.22, 0.22, 0.48, 12]} />
          </mesh>
        );
      })}
      <B p={[x + 2.6, 0, 5.4]} s={[0.8, 1.8, 0.7]} m={M.white} />
      <Plant p={[x - 2.8, 0, 5.5]} />
      {labels !== 'off' && <RoomLabel p={[x, 1.9, 1.2]}>{t('room.pantry')}</RoomLabel>}
    </group>
  );
}

function Stairs({ floor }: { floor: number }) {
  // runs up the right side, from this floor's corridor end to the next floor's front edge
  const steps = 12;
  const z0 = -0.6;
  const z1 = -FLOOR_STEP_BACK + FLOOR_D / 2 - 0.2;
  const run = (z0 - z1) / steps;
  const rise = FLOOR_RISE / steps;
  const o = floorOrigin(floor);
  return (
    <group position={[o[0] + 11.35, o[1], o[2]]}>
      {Array.from({ length: steps }).map((_, i) => (
        <B key={i} p={[0, i * rise, z0 - i * run - run / 2]} s={[1.3, rise, run + 0.02]} m={M.slabTop} />
      ))}
      <mesh position={[0.68, FLOOR_RISE / 2 + 0.45, (z0 + z1) / 2]} rotation-x={Math.atan2(FLOOR_RISE, z0 - z1)} material={M.wallTrim}>
        <boxGeometry args={[0.05, 0.05, Math.hypot(FLOOR_RISE, z0 - z1)]} />
      </mesh>
    </group>
  );
}

interface FloorProps {
  floor: number;
  teams: Team[]; // teams on this floor, in slot order
  labels: LabelMode;
  onSelectTeam: (id: string) => void;
  onCreateTeam: () => void;
  showLabel: boolean;
}

export function Floor({ floor, teams, labels, onSelectTeam, onCreateTeam, showLabel }: FloorProps) {
  const t = useT();
  const o = floorOrigin(floor);
  const hw = FLOOR_W / 2;
  const hd = FLOOR_D / 2;
  return (
    <group position={o}>
      {/* slab */}
      <mesh position={[0, -0.22, 0]} material={M.slabSide} receiveShadow castShadow>
        <boxGeometry args={[FLOOR_W + 0.5, 0.44, FLOOR_D + 0.5]} />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation-x={-Math.PI / 2} material={M.floorWood} receiveShadow>
        <planeGeometry args={[FLOOR_W, FLOOR_D]} />
      </mesh>
      <mesh position={[0, 0.006, 0.25]} rotation-x={-Math.PI / 2} material={M.corridor} receiveShadow>
        <planeGeometry args={[FLOOR_W, 1.5]} />
      </mesh>
      {/* pillars under floors that float over open ground */}
      {floor > 0 &&
        [-hw + 0.3, hw - 0.3].flatMap((x) =>
          [-hd + 0.4, 0, hd - 0.4].map((z) => (
            <mesh key={`${x}${z}`} position={[x, -(FLOOR_RISE * floor) / 2 - 0.22, z]} material={M.pillar} castShadow>
              <boxGeometry args={[0.32, FLOOR_RISE * floor - 0.44, 0.32]} />
            </mesh>
          )),
        )}

      {/* outer walls: tall at the back and left, low on the right, open at the front */}
      <Wall a={[-hw, -hd]} b={[hw, -hd]} h={H_TALL} />
      <Wall a={[-hw, -hd]} b={[-hw, hd]} h={H_TALL} />
      <Wall a={[hw, -hd]} b={[hw, hd]} h={H_LOW} />
      {/* team room partitions and fronts with doors */}
      {[-3.5, 3.5].map((x) => (
        <Wall key={x} a={[x, -hd]} b={[x, -0.5]} h={H_PART} glassTo={1.6} />
      ))}
      {[0, 1, 2].flatMap((s) => {
        const cx = slotX(s);
        return [
          <Wall key={`${s}a`} a={[cx - 3.5, -0.5]} b={[cx - 0.8, -0.5]} h={H_LOW} glassTo={1.1} />,
          <Wall key={`${s}b`} a={[cx + 0.8, -0.5]} b={[cx + 3.5, -0.5]} h={H_LOW} glassTo={1.1} />,
        ];
      })}
      {/* front row */}
      <Wall a={[-hw, 1]} b={[-7.8, 1]} h={H_LOW} glassTo={1.1} />
      <Wall a={[-6.2, 1]} b={[-3.5, 1]} h={H_LOW} glassTo={1.1} />
      <Wall a={[3.5, 1]} b={[6.2, 1]} h={H_LOW} glassTo={1.1} />
      <Wall a={[7.8, 1]} b={[hw, 1]} h={H_LOW} glassTo={1.1} />
      {[-3.5, 3.5].map((x) => (
        <Wall key={`f${x}`} a={[x, 1]} b={[x, hd]} h={H_PART} glassTo={1.6} />
      ))}

      {Array.from({ length: ROOMS_PER_FLOOR }).map((_, s) =>
        teams[s] ? (
          <TeamRoom key={teams[s].id} team={teams[s]} slot={s} labels={labels} onSelect={() => onSelectTeam(teams[s].id)} />
        ) : (
          <EmptyRoom key={`empty-${s}`} slot={s} labels={labels} onCreate={onCreateTeam} />
        ),
      )}
      <MeetingRoom labels={labels} />
      <Lounge labels={labels} />
      {floor === 0 ? <OwnerDesk labels={labels} /> : <Pantry labels={labels} />}

      {showLabel && (
        <Html position={[-hw - 1.4, 0, hd - 1]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <span className="floor-label">{t('stage.floor', { n: floor + 1 })}</span>
        </Html>
      )}
    </group>
  );
}

export { Stairs };

/** Soft ground under the whole building, so shadows land somewhere. */
export function Ground({ floors }: { floors: number }) {
  const depth = FLOOR_D + (floors - 1) * FLOOR_STEP_BACK + 14;
  const zc = -((floors - 1) * FLOOR_STEP_BACK) / 2 - 2;
  // extends to the left so the projector stands on it too
  return (
    <mesh position={[-6, -0.46, zc]} rotation-x={-Math.PI / 2} material={M.ground} receiveShadow>
      <planeGeometry args={[FLOOR_W + 26, depth]} />
    </mesh>
  );
}

