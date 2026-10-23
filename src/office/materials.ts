import * as THREE from 'three';

const std = (color: string, roughness = 0.85, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

// Shared materials keep the draw setup cheap. Palette: warm paper walls, light oak, soft pastels.
export const M = {
  slabTop: std('#EFE8DC'),
  slabSide: std('#D8CCB8'),
  floorWood: std('#E9DDC8'),
  corridor: std('#F3EEE5'),
  wall: std('#F7F4EF'),
  wallTrim: std('#E3DACB'),
  glass: new THREE.MeshStandardMaterial({ color: '#CFE3EE', transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false }),
  wood: std('#CFAE86', 0.7),
  woodDark: std('#A9845F', 0.7),
  white: std('#FBFAF8', 0.8),
  paper: std('#FFFFFF', 1),
  grey: std('#9AA6B0', 0.6),
  charcoal: std('#3A4652', 0.5),
  chair: std('#5A6773', 0.7),
  plant: std('#6FAF7A', 0.9),
  plantDark: std('#4F8F61', 0.9),
  pot: std('#E7DCCB', 0.9),
  sofaBlue: std('#8FA9CC', 0.95),
  sofaRose: std('#E2A8A0', 0.95),
  beanbagA: std('#F2C46D', 0.95),
  beanbagB: std('#9FD3B5', 0.95),
  rugMeeting: std('#D5DEEC', 1),
  rugLounge: std('#F0DCCF', 1),
  rugOwner: std('#E4E0F2', 1),
  screen: std('#2F3B47', 0.4),
  ground: std('#2A3845', 1),
  pillar: std('#E3DACB', 0.8),
  books: [std('#E58A7A'), std('#7FB2D9'), std('#F2C46D'), std('#9FD3B5'), std('#B9A4E6')],
};

const cache = new Map<string, THREE.MeshStandardMaterial>();
/** Pastel material for a team colour (rugs, stickies). */
export function tint(color: string, mixWhite = 0.35) {
  const k = `${color}-${mixWhite}`;
  let m = cache.get(k);
  if (!m) {
    const c = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), mixWhite);
    m = std('#' + c.getHexString(), 1);
    cache.set(k, m);
  }
  return m;
}
