// Building geometry. Every floor has the same plan:
//
//   z = -6  ┌──────────┬──────────┬──────────┐   back row: three team rooms
//           │  team 0  │  team 1  │  team 2  │
//   z=-0.5  └───door───┴───door───┴───door───┘
//                      corridor (z = 0.25)
//   z = 1.0 ┌───door───┬──────────┬───door───┐   front row
//           │ meeting  │ owner /  │  lounge  │
//   z = 6   └──────────┴─ pantry ─┴──────────┘
//          x=-10.5    -3.5       3.5       10.5
//
// Floors stack upwards and step backwards so lower floors stay visible.

export type Vec3 = [number, number, number];

export const ROOMS_PER_FLOOR = 3;
export const FLOOR_W = 21;
export const FLOOR_D = 12;
export const FLOOR_RISE = 4.4;
export const FLOOR_STEP_BACK = 13.2;
export const CORRIDOR_Z = 0.25;

export const floorCount = (teams: number) => Math.max(1, Math.ceil((teams + 0.0001) / ROOMS_PER_FLOOR));
export const floorOrigin = (f: number): Vec3 => [0, f * FLOOR_RISE, -f * FLOOR_STEP_BACK];
export const teamSlot = (index: number) => ({ floor: Math.floor(index / ROOMS_PER_FLOOR), slot: index % ROOMS_PER_FLOOR });
export const slotX = (slot: number) => -7 + 7 * slot;

export const MEETING_C: [number, number] = [-7, 3.6];
export const OWNER_C: [number, number] = [0, 3.6];
export const LOUNGE_C: [number, number] = [7, 3.6];

export type RoomRef = { kind: 'team'; slot: number } | { kind: 'meeting' } | { kind: 'lounge' } | { kind: 'owner' };

/** Front office (ground floor, owner room): the secretary's desk beside the owner's desk. */
export const SECRETARY_DESK: [number, number] = [OWNER_C[0] + 2.45, 2.75];

export function doorOf(r: RoomRef): [number, number] {
  if (r.kind === 'team') return [slotX(r.slot), -0.5];
  if (r.kind === 'meeting') return [MEETING_C[0], 1.0];
  if (r.kind === 'owner') return [OWNER_C[0] + 1.6, 1.0];
  return [LOUNGE_C[0], 1.0];
}

/** Desk spots inside a team room. Index 0 is the manager, at the back. */
export function deskSpot(slot: number, i: number): [number, number] {
  const cx = slotX(slot);
  const spots: [number, number][] = [
    [cx, -4.75],
    [cx - 2.2, -3.05],
    [cx, -3.05],
    [cx + 2.2, -3.05],
    [cx - 2.2, -1.55],
    [cx + 2.2, -1.55],
    [cx - 1.1, -4.75],
    [cx + 1.1, -4.75],
  ];
  return spots[Math.min(i, spots.length - 1)];
}
/** The avatar sits behind the desk, facing the front of the building. */
export const seatAtDesk = (d: [number, number]): [number, number] => [d[0], d[1] - 0.48];

const MT_SEATS: [number, number][] = [-1.65, -0.55, 0.55, 1.65].flatMap((dx) => [
  [MEETING_C[0] + dx, MEETING_C[1] - 1.0] as [number, number],
  [MEETING_C[0] + dx, MEETING_C[1] + 1.0] as [number, number],
]);
export function meetingSeat(i: number): { p: [number, number]; face: number } {
  const p = MT_SEATS[i % MT_SEATS.length];
  return { p, face: p[1] < MEETING_C[1] ? 0 : Math.PI };
}

// Lounge: a sofa along the back wall, one along the right wall, beanbags, a standing spot by the coffee bar.
const LOUNGE_TABLE: [number, number] = [LOUNGE_C[0] + 0.3, LOUNGE_C[1] + 0.5];
const LOUNGE_SEATS: [number, number][] = [
  [LOUNGE_C[0] - 1.4, 1.95],
  [LOUNGE_C[0] - 0.5, 1.95],
  [LOUNGE_C[0] + 0.4, 1.95],
  [LOUNGE_C[0] + 2.75, 3.1],
  [LOUNGE_C[0] + 2.75, 4.0],
  [LOUNGE_C[0] + 2.75, 4.9],
  [LOUNGE_C[0] - 2.2, 4.9],
  [LOUNGE_C[0] - 1.0, 5.35],
  [LOUNGE_C[0] - 2.6, 3.1],
  [LOUNGE_C[0] + 1.4, 5.4],
  [LOUNGE_C[0] - 2.6, 2.1],
  [LOUNGE_C[0] + 1.6, 2.6],
];
export function loungeSeat(i: number): { p: [number, number]; face: number } {
  const base = LOUNGE_SEATS[i % LOUNGE_SEATS.length];
  const ring = Math.floor(i / LOUNGE_SEATS.length);
  const p: [number, number] = [base[0] + ring * 0.35, base[1] - ring * 0.35];
  return { p, face: Math.atan2(LOUNGE_TABLE[0] - p[0], LOUNGE_TABLE[1] - p[1]) };
}

/** Walk path (floor-local x/z) between two rooms on the same floor, through the corridor. */
export function pathBetween(_from: [number, number], fromRoom: RoomRef, to: [number, number], toRoom: RoomRef): [number, number][] {
  const same =
    fromRoom.kind === toRoom.kind && (fromRoom.kind !== 'team' || (toRoom.kind === 'team' && fromRoom.slot === toRoom.slot));
  if (same) return [to];
  const a = doorOf(fromRoom);
  const b = doorOf(toRoom);
  return [a, [a[0], CORRIDOR_Z], [b[0], CORRIDOR_Z], b, to];
}

export function roomCenter(r: RoomRef): [number, number] {
  if (r.kind === 'team') return [slotX(r.slot), -3.25];
  if (r.kind === 'meeting') return MEETING_C;
  if (r.kind === 'owner') return OWNER_C;
  return LOUNGE_C;
}

/**
 * Projector screen standing on the ground to the left of the building, turned to face the default camera.
 * x/z: centre of the screen on the ground; base: height of the screen's bottom edge.
 */
export const PROJECTOR = { x: -23, z: -15, ry: 0.555, base: 2, width: 13, height: 7.4 };
