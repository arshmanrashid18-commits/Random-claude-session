/**
 * Buildings, fields and roads.
 *
 * Every building type has a procedural model that changes with the owner's
 * age (stone-age huts → mudbrick → classical stone → medieval → brick and
 * steam) and culture (pitched, flat, domed or tiered roofs). Parts carry a
 * construction order so buildings rise visibly piece by piece while builders
 * deliver materials; scaffolding stands around sites under construction.
 * Farms are crop fields that sprout, ripen and are harvested with the seasons.
 * Roads follow the terrain and improve with age.
 */
import * as THREE from 'three';
import { GLSL_CONSTANTS, GLSL_CUBESPHERE, GLSL_DETAIL, GLSL_HEIGHT, GLSL_NOISE } from './glsl/common';
import { GLSL_FRAME, OBJECT_FS_HEAD } from './glsl/objects';
import { MeshBuilder, lin, type PartOpts } from './meshkit';
import type { SharedUniforms } from './planet/terrain';
import { groundHeight } from './groundHeight';
import { PLANET_RADIUS } from '../sim/constants';
import { BType, BUILDINGS } from '../sim/civ/defs';
import type { CivData, TribeData } from '../worker/protocol';
import type { PlanetData } from './planet/planetData';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const E = (x: number, y: number, z: number) => new THREE.Euler(x, y, z);

interface Palette { wall: number; wall2: number; roof: number; trim: number; ground: number }
const AGE_PALETTES: Palette[] = [
  { wall: 0x9c7a55, wall2: 0x7a5a3c, roof: 0xb8995a, trim: 0x5a4028, ground: 0x6e5a40 },   // stone age: wattle, thatch
  { wall: 0xc2a276, wall2: 0xa2845c, roof: 0xa8894e, trim: 0x6a4a2e, ground: 0x8a7458 },   // bronze/iron: mudbrick, reed
  { wall: 0xdcd2c0, wall2: 0xc4b8a2, roof: 0xb4583c, trim: 0x8a8070, ground: 0xa89c86 },   // classical: limestone, terracotta
  { wall: 0xe4d8c0, wall2: 0x8e887e, roof: 0x4c4c5a, trim: 0x4e3626, ground: 0x807a70 },   // medieval: plaster+timber, slate
  { wall: 0xa0503a, wall2: 0xd8d0c4, roof: 0x55565f, trim: 0xe8e0d0, ground: 0x6a6660 },   // renaissance/steam: brick
];

export function ageGroup(age: number): number {
  return age <= 0 ? 0 : age <= 2 ? 1 : age === 3 ? 2 : age === 4 ? 3 : 4;
}

/** Builder wrapper that numbers parts in construction order. */
class Parts {
  b = new MeshBuilder();
  order = 0;
  total = 1;
  p(o: Omit<PartOpts, 'tag'> & { tag?: number }): PartOpts {
    return { ...o, tag: this.order++ };
  }
}

function roofFor(P: Parts, style: number, w: number, d: number, y: number, h: number, col: [number, number, number], trim: [number, number, number]): void {
  const b = P.b;
  switch (style) {
    case 0: b.roof(w, d, h, V(0, y, 0), P.p({ color: col, jitter: 0.08, ao: 0.2 })); break;
    case 1:
      b.box(w + 0.1, 0.18, d + 0.1, V(0, y, 0), P.p({ color: col }));
      b.box(w + 0.25, 0.3, 0.12, V(0, y + 0.18, d / 2 + 0.06), P.p({ color: trim }));
      b.box(w + 0.25, 0.3, 0.12, V(0, y + 0.18, -d / 2 - 0.06), P.p({ color: trim }));
      break;
    case 2: b.cone(Math.max(w, d) * 0.72, h * 1.25, 12, V(0, y, 0), P.p({ color: col, jitter: 0.06 })); break;
    default:
      b.box(w + 0.8, 0.12, d + 0.8, V(0, y, 0), P.p({ color: trim }));
      b.roof(w + 0.5, d + 0.5, h * 0.6, V(0, y + 0.1, 0), P.p({ color: col }), undefined, 0.3);
      b.box(w * 0.55, h * 0.35, d * 0.55, V(0, y + h * 0.5, 0), P.p({ color: col }));
      b.roof(w * 0.7, d * 0.7, h * 0.45, V(0, y + h * 0.82, 0), P.p({ color: col }), undefined, 0.25);
  }
}

/** A house-like block: walls + door + windows + roof. */
function block(P: Parts, pal: Palette, g: number, style: number, w: number, d: number, h: number, x = 0, z = 0): void {
  const b = P.b;
  const wall = lin(pal.wall), wall2 = lin(pal.wall2), roofC = lin(pal.roof), trim = lin(pal.trim);
  b.box(w + 0.3, 0.9, d + 0.3, V(x, -0.75, z), P.p({ color: lin(pal.ground) }));
  if (g === 0 && style !== 1) {
    // Round wattle hut with a conical thatch roof.
    b.cylinder(w * 0.55, w * 0.6, h, 10, V(x, 0, z), P.p({ color: wall, jitter: 0.1, ao: 0.3 }));
    b.cone(w * 0.85, h * 1.2, 10, V(x, h - 0.05, z), P.p({ color: roofC, jitter: 0.12 }));
    b.box(0.5, 0.9, 0.12, V(x, 0, z + w * 0.58), P.p({ color: trim }));
    return;
  }
  b.box(w, h, d, V(x, 0, z), P.p({ color: wall, jitter: 0.04, ao: 0.25 }));
  if (g === 3) {
    // Timber framing.
    for (const sx of [-1, 1]) b.box(0.12, h, 0.12, V(x + sx * w / 2, 0, z + d / 2), P.p({ color: trim }));
    b.box(w, 0.12, 0.08, V(x, h * 0.55, z + d / 2 + 0.02), P.p({ color: trim }));
  }
  if (g === 4) b.box(w + 0.05, 0.15, d + 0.05, V(x, h * 0.62, z), P.p({ color: wall2 }));
  b.box(0.45, Math.min(1.0, h * 0.7), 0.1, V(x, 0, z + d / 2 + 0.02), P.p({ color: trim }));
  const win = lin(0x2a2420);
  if (w > 1.8) for (const sx of [-1, 1]) b.box(0.32, 0.36, 0.08, V(x + sx * w * 0.3, h * 0.45, z + d / 2 + 0.03), P.p({ slot: 7, color: win }));
  roofFor(P, g === 0 ? 2 : style, w, d, h, Math.max(0.8, Math.min(w, d) * 0.5), roofC, trim);
  if (g === 4 && style !== 2) b.box(0.3, 1.1, 0.3, V(x + w * 0.3, h + 0.2, z - d * 0.2), P.p({ color: lin(0x6a3a2a) }));
}

function buildModel(type: number, g: number, style: number): THREE.BufferGeometry {
  const P = new Parts();
  const b = P.b;
  const pal = AGE_PALETTES[g];
  const wall = lin(pal.wall), trim = lin(pal.trim), roofC = lin(pal.roof), stone = lin(0x8e8a82), wood = lin(0x6a4a30);
  switch (type) {
    case BType.House: {
      const s = [1.0, 1.1, 1.2, 1.25, 1.35][g];
      block(P, pal, g, style, 2.6 * s, 2.2 * s, (g === 0 ? 1.4 : 1.7) * s + (g >= 3 ? 0.6 : 0));
      if (g >= 3 && style === 0) block(P, pal, g, style, 1.4, 1.3, 1.3, 1.5, -0.6);
      break;
    }
    case BType.Storehouse: {
      block(P, pal, Math.max(1, g), style, 3.8, 3.0, 2.1);
      for (const sx of [-1, 1]) b.cylinder(0.35, 0.4, 0.8, 8, V(sx * 2.4, 0, 1.2), P.p({ color: wood }));
      b.box(1.1, 0.7, 0.8, V(-2.6, 0, -0.8), P.p({ color: lin(0x9a7a46) }));
      break;
    }
    case BType.Temple: {
      b.box(6.2, 1.2, 6.2, V(0, -0.8, 0), P.p({ color: stone }));
      b.box(5.4, 0.4, 5.4, V(0, 0.4, 0), P.p({ color: wall }));
      if (g >= 2) for (let k = 0; k < 6; k++) for (const sz of [-1, 1]) b.cylinder(0.18, 0.2, 2.8, 8, V(-2.2 + k * 0.88, 0.8, sz * 2.1), P.p({ color: wall }));
      else b.box(4.4, 2.6, 3.8, V(0, 0.8, 0), P.p({ color: wall, ao: 0.2 }));
      if (style === 2 || g === 3) {
        b.cylinder(2.2, 2.4, 1.2, 14, V(0, 3.6, 0), P.p({ color: wall }));
        b.blob(2.2, 2, V(0, 4.6, 0), V(1, 0.85, 1), P.p({ color: g === 4 ? lin(0x5a8a78) : roofC }), 0.0);
        b.cone(0.18, 1.6, 6, V(0, 6.3, 0), P.p({ color: lin(0xe0c070) }));
      } else if (style === 3) {
        roofFor(P, 3, 5.0, 4.4, 3.6, 2.2, roofC, trim);
      } else {
        b.roof(5.2, 4.8, 1.8, V(0, 3.6, 0), P.p({ color: roofC }), E(0, Math.PI / 2, 0));
      }
      b.box(0.9, 1.6, 0.4, V(0, 0.6, 2.9), P.p({ slot: 1 }));
      break;
    }
    case BType.Library: {
      b.box(6, 0.8, 4.6, V(0, -0.6, 0), P.p({ color: stone }));
      b.box(5.4, 2.8, 4.0, V(0, 0.2, 0), P.p({ color: wall, ao: 0.2 }));
      for (let k = 0; k < 5; k++) b.cylinder(0.16, 0.18, 2.6, 8, V(-2.2 + k * 1.1, 0.2, 2.2), P.p({ color: lin(0xece4d4) }));
      roofFor(P, style === 2 ? 0 : style, 5.8, 4.6, 3.0, 1.4, roofC, trim);
      break;
    }
    case BType.Market: {
      b.box(7, 0.4, 7, V(0, -0.3, 0), P.p({ color: stone }));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        const x = Math.cos(a) * 2.2, z = Math.sin(a) * 2.2;
        for (const [px, pz] of [[-0.7, -0.5], [0.7, -0.5], [-0.7, 0.5], [0.7, 0.5]]) b.segment(V(x + px, 0, z + pz), V(x + px, 1.7, z + pz), 0.06, 0.06, 4, P.p({ color: wood }));
        b.roof(1.8, 1.4, 0.5, V(x, 1.7, z), P.p({ slot: k % 2 ? 1 : 2 }), E(0, a, 0), 0.1);
        b.box(1.2, 0.5, 0.7, V(x, 0, z), P.p({ color: lin([0xb07030, 0x7a9a3a, 0xc0a040, 0x9a4a3a][k]) }));
      }
      b.cylinder(0.5, 0.6, 0.9, 10, V(0, 0, 0), P.p({ color: stone }));
      break;
    }
    case BType.Barracks: {
      block(P, pal, Math.max(1, g), style === 2 ? 0 : style, 6.0, 2.6, 2.0);
      b.segment(V(3.4, 0, 1.6), V(3.4, 4.2, 1.6), 0.06, 0.05, 5, P.p({ color: wood }));
      b.quad(1.2, 0.8, V(3.4, 3.3, 1.6), E(0, Math.PI / 2, Math.PI / 2), P.p({ slot: 1, sway: 1 }));
      for (let k = 0; k < 3; k++) b.segment(V(-2 + k, 0, 2), V(-2 + k + 0.2, 1.4, 2.2), 0.04, 0.03, 4, P.p({ color: wood }));
      break;
    }
    case BType.Wall: {
      if (g <= 1) {
        // Palisade of sharpened stakes.
        for (let k = 0; k < 13; k++) b.cylinder(0.14, 0.2, 3.4, 5, V(-3.0 + k * 0.5, -0.8, 0), P.p({ color: wood, jitter: 0.2 }));
        for (let k = 0; k < 13; k++) b.cone(0.16, 0.4, 5, V(-3.0 + k * 0.5, 2.6, 0), P.p({ color: wood }));
      } else {
        b.box(6.4, 3.4, 1.3, V(0, -0.8, 0), P.p({ color: stone, jitter: 0.1, ao: 0.3 }));
        b.box(6.4, 0.25, 1.6, V(0, 2.6, 0), P.p({ color: stone }));
        for (let k = 0; k < 6; k++) b.box(0.6, 0.55, 1.4, V(-2.75 + k * 1.1, 3.0, 0), P.p({ color: stone }));
      }
      break;
    }
    case BType.Tower: {
      if (g <= 1) {
        for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.segment(V(px, 0, pz), V(px * 0.7, 5, pz * 0.7), 0.1, 0.08, 5, P.p({ color: wood }));
        b.box(2.2, 0.2, 2.2, V(0, 5, 0), P.p({ color: wood }));
        b.cone(1.6, 1.4, 4, V(0, 5.8, 0), P.p({ color: roofC }), E(0, Math.PI / 4, 0));
      } else {
        b.cylinder(1.3, 1.5, 7.5, 12, V(0, -1, 0), P.p({ color: stone, jitter: 0.06, ao: 0.3 }));
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.box(0.4, 0.5, 0.4, V(Math.cos(a) * 1.3, 6.5, Math.sin(a) * 1.3), P.p({ color: stone })); }
        if (style !== 1) b.cone(1.6, 2.4, 12, V(0, 6.6, 0), P.p({ color: roofC }));
        b.quad(0.9, 0.6, V(0, 8.8, 0), E(0, 0, Math.PI / 2), P.p({ slot: 1, sway: 1 }));
      }
      break;
    }
    case BType.Harbor: {
      b.box(2.2, 0.25, 9, V(0, 0.3, 3.5), P.p({ color: wood }));
      for (let k = 0; k < 5; k++) for (const sx of [-1, 1]) b.segment(V(sx * 1.1, -2, k * 2), V(sx * 1.1, 0.6, k * 2), 0.1, 0.1, 5, P.p({ color: lin(0x4a3422) }));
      block(P, pal, Math.max(1, g), style, 3, 2.4, 1.8, 0, -2.5);
      // A moored boat.
      b.blob(1, 1, V(2.4, 0.2, 5), V(0.7, 0.35, 2.2), P.p({ color: lin(0x6b4a2c) }), 0.02);
      b.segment(V(2.4, 0.3, 5), V(2.4, 3.2, 5), 0.05, 0.04, 4, P.p({ color: wood }));
      b.quad(1.2, 2.0, V(2.4, 1.1, 5), E(0, Math.PI / 2, 0), P.p({ color: lin(0xe8e0cc), sway: 0.5 }));
      break;
    }
    case BType.Monument: {
      b.box(7, 1, 7, V(0, -0.6, 0), P.p({ color: stone }));
      if (style === 1 || g <= 1) {
        // Stepped pyramid.
        for (let k = 0; k < 5; k++) b.box(6 - k * 1.1, 1.2, 6 - k * 1.1, V(0, 0.4 + k * 1.2, 0), P.p({ color: lin(k % 2 ? 0xd8c8a0 : 0xc8b890) }));
        b.box(1.4, 1.2, 1.4, V(0, 6.4, 0), P.p({ slot: 1 }));
      } else if (style === 2) {
        // Colossal figure.
        b.box(2.4, 2, 2.4, V(0, 0.4, 0), P.p({ color: stone }));
        b.segment(V(0, 2.4, 0), V(0, 7.2, 0), 0.9, 0.7, 10, P.p({ color: lin(0xb8b0a0) }));
        b.blob(0.8, 1, V(0, 8.0, 0), V(1, 1.1, 1), P.p({ color: lin(0xb8b0a0) }));
        b.segment(V(0.7, 6.6, 0), V(1.6, 9.0, 0.2), 0.25, 0.2, 6, P.p({ color: lin(0xb8b0a0) }));
        b.blob(0.35, 1, V(1.7, 9.4, 0.2), V(1, 1.4, 1), P.p({ slot: 7, color: lin(0xffd080) }));
      } else {
        // Obelisk ring.
        b.box(1.4, 9, 1.4, V(0, 0.4, 0), P.p({ color: lin(0xcfc6b4) }));
        b.cone(1.0, 1.4, 4, V(0, 9.4, 0), P.p({ color: lin(0xe0c070) }), E(0, Math.PI / 4, 0));
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.box(0.5, 2.6, 0.5, V(Math.cos(a) * 3, 0.4, Math.sin(a) * 3), P.p({ color: stone })); }
      }
      break;
    }
    case BType.Well: {
      b.cylinder(0.8, 0.85, 0.8, 12, V(0, -0.2, 0), P.p({ color: stone }));
      for (const sx of [-1, 1]) b.segment(V(sx * 0.7, 0.5, 0), V(sx * 0.7, 1.9, 0), 0.06, 0.06, 4, P.p({ color: wood }));
      b.roof(1.8, 1.2, 0.6, V(0, 1.9, 0), P.p({ color: roofC }));
      break;
    }
    case BType.Workshop: {
      block(P, pal, Math.max(1, g), style === 2 ? 0 : style, 4.2, 3.2, 2.2);
      b.cylinder(0.35, 0.45, g >= 4 ? 6 : 3.4, 8, V(1.5, 0, -1.2), P.p({ color: g >= 4 ? lin(0x7a3a2a) : stone }));
      b.blob(0.3, 1, V(1.5, g >= 4 ? 6.1 : 3.5, -1.2), V(1, 0.5, 1), P.p({ slot: 7, color: lin(0xff8030) }));
      b.box(0.8, 0.8, 0.6, V(-2.6, 0, 1.2), P.p({ color: lin(0x4a4a50) }));
      break;
    }
    case BType.Observatory: {
      b.box(4, 2.2, 4, V(0, -0.4, 0), P.p({ color: wall }));
      b.cylinder(1.6, 1.8, 1.4, 14, V(0, 1.8, 0), P.p({ color: wall }));
      b.blob(1.7, 2, V(0, 3.2, 0), V(1, 0.8, 1), P.p({ color: lin(0xb8c0c8) }), 0);
      b.segment(V(0, 3.2, 0), V(0.8, 4.8, 0.8), 0.22, 0.18, 8, P.p({ color: lin(0x6a5a3a) }));
      break;
    }
    case BType.Healer: {
      block(P, pal, g, style, 3.4, 2.6, 1.9);
      for (let k = 0; k < 6; k++) b.blob(0.3, 0, V(-1.6 + (k % 3) * 0.8, 0.15, 2.2 + Math.floor(k / 3) * 0.6), V(1, 0.6, 1), P.p({ color: lin([0x6a9a3a, 0x9a7ac0, 0xc0a040][k % 3]) }));
      break;
    }
    case BType.Hall: {
      block(P, pal, Math.max(1, g), style, 7.0, 4.4, g >= 2 ? 3.4 : 2.6);
      for (const sx of [-1, 1]) {
        b.segment(V(sx * 3.9, 0, 2.6), V(sx * 3.9, 5.2, 2.6), 0.07, 0.06, 5, P.p({ color: wood }));
        b.quad(0.9, 1.6, V(sx * 3.9, 3.3, 2.6), E(0, 0, 0), P.p({ slot: 1, sway: 0.6 }));
      }
      break;
    }
    case BType.Quarry: {
      b.box(5, 1.2, 4, V(0, -1.4, 0), P.p({ color: lin(0x7a746a) }));
      for (let k = 0; k < 5; k++) b.box(0.8, 0.6, 0.8, V(-1.6 + k * 0.8, -0.3 + (k % 2) * 0.1, 1.4 - (k % 3) * 0.8), P.p({ color: lin(0xa29a8c), jitter: 0.1 }));
      b.segment(V(-2.4, 0, -1.8), V(-1.8, 3.2, -1.2), 0.08, 0.06, 4, P.p({ color: wood }));
      b.segment(V(-1.8, 3.2, -1.2), V(0.4, 2.4, -0.4), 0.05, 0.05, 4, P.p({ color: wood }));
      break;
    }
    case BType.Mine: {
      b.blob(2.2, 1, V(0, -0.2, -0.8), V(1.2, 0.8, 1.0), P.p({ color: lin(0x6e665c) }), 0.2);
      b.box(1.8, 2.0, 0.3, V(0, 0, 1.2), P.p({ color: wood }));
      b.box(1.0, 1.4, 0.34, V(0, 0, 1.24), P.p({ color: lin(0x141210) }));
      b.box(0.9, 0.6, 1.4, V(1.6, 0, 2.2), P.p({ color: lin(0x4a3a2a) }));
      b.box(0.8, 0.3, 1.2, V(1.6, 0.6, 2.2), P.p({ color: lin(0x3a3a40) }));
      break;
    }
    default:
      block(P, pal, g, style, 2.5, 2.5, 2);
  }
  const geo = b.build();
  // Convert part index to normalised construction order.
  const tag = geo.getAttribute('aTag') as THREE.BufferAttribute;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const total = Math.max(1, P.order);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) { minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i)); }
  for (let i = 0; i < tag.count; i++) {
    const y01 = (pos.getY(i) - minY) / Math.max(0.01, maxY - minY);
    tag.setX(i, (tag.getX(i) + y01 * 0.6) / total);
  }
  void trim;
  return geo;
}

const BLD_VS = /* glsl */ `
precision highp float;
${GLSL_CONSTANTS}
${GLSL_FRAME}
in vec3 aDir;
in vec4 aInst; // ground, rot, progress, ruin
in vec2 aCol;  // tribe colour, tribe colour 2
in float aTag;
in float aSlot;
in float aSway;
in vec3 color;
uniform float uTime;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out float vOrder;
out float vProgress;
out float vRuin;
out float vWindow;
vec3 unpackRGB(float c) {
  float r = floor(c / 65536.0);
  float g = floor(mod(c / 256.0, 256.0));
  float b = mod(c, 256.0);
  return pow(vec3(r, g, b) / 255.0, vec3(2.2));
}
void main() {
  vec3 up = aDir;
  vec3 ax, az;
  tangentFrame(up, aInst.y, ax, az);
  vec3 lp = position;
  // Banners and sails flutter.
  lp.x += aSway * sin(uTime * 3.0 + lp.y * 2.0 + aDir.x * 50.0) * 0.12 * lp.y * 0.2;
  float ruin = aInst.w;
  if (ruin > 0.5) lp.y *= 0.55;
  vWorld = up * (PLANET_R + aInst.x) + ax * lp.x + up * lp.y + az * lp.z;
  vNormal = normalize(ax * normal.x + up * normal.y + az * normal.z);
  vec3 c1 = unpackRGB(aCol.x), c2 = unpackRGB(aCol.y);
  vColor = aSlot < 0.5 ? color : aSlot < 1.5 ? c1 : aSlot < 2.5 ? c2 : color;
  vWindow = aSlot > 6.5 ? 1.0 : 0.0;
  vOrder = aTag;
  vProgress = aInst.z;
  vRuin = ruin;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

/** Shadow pass: unbuilt parts must not cast shadows either. */
const BLD_DEPTH_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
in float vOrder;
in float vProgress;
void main() {
  if (vOrder > vProgress + 0.001) discard;
  outColor = vec4(1.0);
}
`;

const BLD_FS = /* glsl */ `
${OBJECT_FS_HEAD}
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in float vOrder;
in float vProgress;
in float vRuin;
in float vWindow;
void main() {
  if (vOrder > vProgress + 0.001) discard;
  vec3 col = vColor;
  // Freshly placed parts glow faintly as they are added.
  float fresh = smoothstep(vProgress - 0.06, vProgress, vOrder) * step(vProgress, 0.999);
  if (vRuin > 0.5) col *= vec3(0.45, 0.42, 0.4);
  vec3 up = normalize(vWorld);
  float night = 1.0 - smoothstep(-0.12, 0.08, dot(up, uSunDir));
  float lit = vWindow * night * (1.0 - vRuin) * step(0.999, vProgress);
  vec3 c = shadeObject(vWorld, normalize(vNormal), col, 0.0, lit, vec3(6.0, 3.4, 1.4));
  c += vec3(1.2, 1.0, 0.6) * fresh * 0.4;
  outColor = vec4(c, 1.0);
}
`;

const FIELD_VS = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
${GLSL_CONSTANTS}
${GLSL_CUBESPHERE}
${GLSL_HEIGHT}
${GLSL_NOISE}
${GLSL_DETAIL}
${GLSL_FRAME}
in vec3 aDir;
in vec4 aInst; // radius, rot, growth, ruin
out vec3 vWorld;
out vec2 vLocal;
out float vGrowth;
out float vRuin;
void main() {
  vec3 ax, az;
  tangentFrame(aDir, aInst.y, ax, az);
  float r = aInst.x;
  vec3 p = aDir * PLANET_R + ax * position.x * r + az * position.z * r;
  vec3 dir = normalize(p);
  float h = groundHeight(dir);
  vWorld = dir * (PLANET_R + h + 0.06);
  vLocal = position.xz;
  vGrowth = aInst.z;
  vRuin = aInst.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const FIELD_FS = /* glsl */ `
${OBJECT_FS_HEAD}
in vec3 vWorld;
in vec2 vLocal;
in float vGrowth;
in float vRuin;
void main() {
  vec2 q = vLocal;
  float edge = max(abs(q.x), abs(q.y));
  if (edge > 0.98) discard;
  vec3 up = normalize(vWorld);
  vec4 clim = texture(uClimateTex, regionUV(up));
  float temp = clim.r * 80.0 - 40.0;
  float rows = 0.5 + 0.5 * sin(q.x * 38.0);
  vec3 soil = pow(vec3(0.42, 0.3, 0.2), vec3(2.2));
  vec3 sprout = pow(vec3(0.38, 0.6, 0.22), vec3(2.2));
  vec3 ripe = pow(vec3(0.85, 0.7, 0.3), vec3(2.2));
  float g = clamp(vGrowth, 0.0, 1.0);
  vec3 crop = g < 0.55 ? mix(soil, sprout, smoothstep(0.02, 0.4, g)) : mix(sprout, ripe, smoothstep(0.55, 0.95, g));
  float cover = smoothstep(0.02, 0.3, g) * mix(0.55, 1.0, rows);
  vec3 col = mix(soil * (0.85 + 0.15 * rows), crop, cover);
  if (temp < 2.0) col = mix(col, soil * 0.9, 0.7);
  col = mix(col, soil * 0.6, vRuin);
  // Hedge border.
  col = mix(col, pow(vec3(0.25, 0.35, 0.15), vec3(2.2)), smoothstep(0.9, 0.97, edge));
  vec3 c = shadeObject(vWorld, up, col, 0.0, 0.0, vec3(0.0));
  outColor = vec4(c, 1.0);
}
`;

const ROAD_VS = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
${GLSL_CONSTANTS}
${GLSL_CUBESPHERE}
${GLSL_HEIGHT}
${GLSL_NOISE}
${GLSL_DETAIL}
in float aLevel;
in float aSide;
out vec3 vWorld;
out float vLevel;
out float vSide;
void main() {
  vec3 dir = normalize(position);
  float h = groundHeight(dir);
  vWorld = dir * (PLANET_R + h + 0.05);
  vLevel = aLevel;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const ROAD_FS = /* glsl */ `
${OBJECT_FS_HEAD}
in vec3 vWorld;
in float vLevel;
in float vSide;
void main() {
  float a = 1.0 - smoothstep(0.6, 1.0, abs(vSide));
  vec3 dirt = pow(vec3(0.5, 0.4, 0.28), vec3(2.2));
  vec3 cobble = pow(vec3(0.55, 0.52, 0.48), vec3(2.2));
  vec3 col = mix(dirt, cobble, clamp(vLevel / 2.0, 0.0, 1.0));
  float n = snoise(vWorld * 1.7);
  col *= 0.85 + n * 0.15;
  vec3 up = normalize(vWorld);
  vec3 c = shadeObject(vWorld, up, col, 0.0, 0.0, vec3(0.0));
  outColor = vec4(c, a * 0.9);
}
`;

const SCAFFOLD_COLOR = lin(0x8a6a44);
function scaffoldGeometry(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.segment(V(x, -0.5, z), V(x, 3.2, z), 0.035, 0.035, 4, { color: SCAFFOLD_COLOR });
  for (const y of [1.1, 2.3]) {
    b.segment(V(-1, y, -1), V(1, y, -1), 0.03, 0.03, 4, { color: SCAFFOLD_COLOR });
    b.segment(V(-1, y, 1), V(1, y, 1), 0.03, 0.03, 4, { color: SCAFFOLD_COLOR });
    b.segment(V(-1, y, -1), V(-1, y, 1), 0.03, 0.03, 4, { color: SCAFFOLD_COLOR });
    b.segment(V(1, y, -1), V(1, y, 1), 0.03, 0.03, 4, { color: SCAFFOLD_COLOR });
  }
  b.segment(V(-1, 0, -1), V(1, 2.3, -1), 0.025, 0.025, 4, { color: SCAFFOLD_COLOR });
  return b.build();
}

const SCAFFOLD_VS = /* glsl */ `
precision highp float;
${GLSL_CONSTANTS}
${GLSL_FRAME}
in vec3 aDir;
in vec4 aInst; // ground, rot, scale, height
in vec3 color;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
void main() {
  vec3 ax, az;
  tangentFrame(aDir, aInst.y, ax, az);
  vec3 lp = position * vec3(aInst.z, aInst.w, aInst.z);
  vWorld = aDir * (PLANET_R + aInst.x) + ax * lp.x + aDir * lp.y + az * lp.z;
  vNormal = normalize(ax * normal.x + aDir * normal.y + az * normal.z);
  vColor = color;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;
const SCAFFOLD_FS = /* glsl */ `
${OBJECT_FS_HEAD}
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
void main() { outColor = vec4(shadeObject(vWorld, normalize(vNormal), vColor, 0.0, 0.0, vec3(0.0)), 1.0); }
`;

interface Batch {
  geo: THREE.InstancedBufferGeometry;
  mesh: THREE.Mesh;
  arr: Float32Array;
  buf: THREE.InstancedInterleavedBuffer;
  cap: number;
}

const STRIDE = 9;

export class BuildingsRenderer {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  readonly depthMaterial: THREE.ShaderMaterial;
  private batches = new Map<string, Batch>();
  private fieldMesh: THREE.Mesh;
  private fieldGeo: THREE.InstancedBufferGeometry;
  private fieldArr = new Float32Array(0);
  private fieldBuf: THREE.InstancedInterleavedBuffer | null = null;
  private roadMesh: THREE.Mesh | null = null;
  private roadMat: THREE.ShaderMaterial;
  private scaffoldGeo: THREE.InstancedBufferGeometry;
  private scaffoldMesh: THREE.Mesh;
  private scaffoldArr = new Float32Array(0);
  meshesForShadow: THREE.Mesh[] = [];
  onNewMesh: (m: THREE.Mesh) => void = () => {};
  count = 0;
  /** Latest civ snapshot (viewpoints, inspector). */
  latest: CivData | null = null;
  private lastVersion = -1;

  constructor(shared: SharedUniforms) {
    this.material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BLD_VS, fragmentShader: BLD_FS, uniforms: { ...shared } });
    this.depthMaterial = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BLD_VS, fragmentShader: BLD_DEPTH_FS, uniforms: this.material.uniforms, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
    // Fields.
    const plane = new THREE.PlaneGeometry(2, 2, 8, 8);
    plane.rotateX(-Math.PI / 2);
    this.fieldGeo = new THREE.InstancedBufferGeometry();
    this.fieldGeo.index = plane.index;
    this.fieldGeo.setAttribute('position', plane.getAttribute('position'));
    this.fieldGeo.setAttribute('normal', plane.getAttribute('normal'));
    this.fieldGeo.instanceCount = 0;
    const fieldMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FIELD_VS, fragmentShader: FIELD_FS, uniforms: { ...shared }, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.fieldMesh = new THREE.Mesh(this.fieldGeo, fieldMat);
    this.fieldMesh.frustumCulled = false;
    this.fieldMesh.renderOrder = 2;
    this.group.add(this.fieldMesh);
    this.roadMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: ROAD_VS, fragmentShader: ROAD_FS, uniforms: { ...shared },
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const sc = scaffoldGeometry();
    this.scaffoldGeo = new THREE.InstancedBufferGeometry();
    this.scaffoldGeo.index = sc.index;
    for (const n of ['position', 'normal', 'color']) this.scaffoldGeo.setAttribute(n, sc.getAttribute(n));
    this.scaffoldGeo.instanceCount = 0;
    const scMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SCAFFOLD_VS, fragmentShader: SCAFFOLD_FS, uniforms: { ...shared } });
    this.scaffoldMesh = new THREE.Mesh(this.scaffoldGeo, scMat);
    this.scaffoldMesh.frustumCulled = false;
    this.group.add(this.scaffoldMesh);
  }

  private batch(key: string, type: number, g: number, style: number): Batch {
    let bt = this.batches.get(key);
    if (bt) return bt;
    const src = buildModel(type, g, style);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = src.index;
    for (const n of ['position', 'normal', 'color', 'aTag', 'aSlot', 'aSway']) geo.setAttribute(n, src.getAttribute(n));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    mesh.name = `bld-${key}`;
    this.group.add(mesh);
    bt = { geo, mesh, arr: new Float32Array(0), buf: new THREE.InstancedInterleavedBuffer(new Float32Array(STRIDE), STRIDE, 1), cap: 0 };
    this.batches.set(key, bt);
    this.meshesForShadow.push(mesh);
    this.onNewMesh(mesh);
    return bt;
  }

  private ensure(bt: Batch, n: number): void {
    if (n <= bt.cap) return;
    let cap = Math.max(16, bt.cap);
    while (cap < n) cap *= 2;
    bt.arr = new Float32Array(cap * STRIDE);
    bt.buf = new THREE.InstancedInterleavedBuffer(bt.arr, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    // Growing instance buffers: dispose first so three.js forgets the cached
    // drawable instance count (it is computed once per geometry).
    bt.geo.dispose();
    bt.geo.setAttribute('aDir', new THREE.InterleavedBufferAttribute(bt.buf, 3, 0));
    bt.geo.setAttribute('aInst', new THREE.InterleavedBufferAttribute(bt.buf, 4, 3));
    bt.geo.setAttribute('aCol', new THREE.InterleavedBufferAttribute(bt.buf, 2, 7));
    bt.cap = cap;
  }

  /** Rebuild instance data from the latest civ snapshot. */
  sync(civ: CivData, data: PlanetData): void {
    this.latest = civ;
    const tribes = civ.tribes;
    const groups = new Map<string, number[]>();
    const fields: number[] = [];
    const scaff: number[] = [];
    civ.buildings.forEach((b, idx) => {
      if (b.type === BType.Farm) { fields.push(idx); return; }
      const g = ageGroup(b.age);
      const key = `${b.type}:${g}:${b.style}`;
      let arr = groups.get(key);
      if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(idx);
      if (!b.complete && !b.ruin) scaff.push(idx);
    });
    for (const bt of this.batches.values()) bt.geo.instanceCount = 0;
    let total = 0;
    for (const [key, list] of groups) {
      const [type, g, style] = key.split(':').map(Number);
      const bt = this.batch(key, type, g, style);
      this.ensure(bt, list.length);
      list.forEach((idx, k) => {
        const b = civ.buildings[idx];
        const t: TribeData | undefined = tribes[b.tribe];
        const o = k * STRIDE;
        bt.arr[o] = b.x; bt.arr[o + 1] = b.y; bt.arr[o + 2] = b.z;
        bt.arr[o + 3] = groundHeight(data.heights, data.n, b.x, b.y, b.z) - 0.05;
        bt.arr[o + 4] = b.rot;
        bt.arr[o + 5] = b.complete ? 1 : Math.max(0.02, b.progress);
        bt.arr[o + 6] = b.ruin ? 1 : 0;
        bt.arr[o + 7] = t ? t.color : 0x888888;
        bt.arr[o + 8] = t ? t.color2 : 0xcccccc;
      });
      bt.geo.instanceCount = list.length;
      bt.buf.clearUpdateRanges();
      bt.buf.addUpdateRange(0, list.length * STRIDE);
      bt.buf.needsUpdate = true;
      total += list.length;
    }
    this.count = total;
    // Fields.
    if (this.fieldArr.length < fields.length * 7) {
      this.fieldArr = new Float32Array(Math.max(16, fields.length * 2) * 7);
      this.fieldBuf = new THREE.InstancedInterleavedBuffer(this.fieldArr, 7, 1).setUsage(THREE.DynamicDrawUsage);
      this.fieldGeo.dispose(); // forget the cached instance count (see ensure())
      this.fieldGeo.setAttribute('aDir', new THREE.InterleavedBufferAttribute(this.fieldBuf, 3, 0));
      this.fieldGeo.setAttribute('aInst', new THREE.InterleavedBufferAttribute(this.fieldBuf, 4, 3));
    }
    fields.forEach((idx, k) => {
      const b = civ.buildings[idx];
      const o = k * 7;
      this.fieldArr[o] = b.x; this.fieldArr[o + 1] = b.y; this.fieldArr[o + 2] = b.z;
      this.fieldArr[o + 3] = BUILDINGS[BType.Farm].radius * (b.complete ? 1 : Math.max(0.3, b.progress));
      this.fieldArr[o + 4] = b.rot;
      this.fieldArr[o + 5] = b.growth;
      this.fieldArr[o + 6] = b.ruin ? 1 : 0;
    });
    this.fieldGeo.instanceCount = fields.length;
    if (this.fieldBuf) { this.fieldBuf.clearUpdateRanges(); this.fieldBuf.addUpdateRange(0, fields.length * 7); this.fieldBuf.needsUpdate = true; }
    // Scaffolding.
    if (this.scaffoldArr.length < scaff.length * 7 || this.scaffoldArr.length === 0) {
      this.scaffoldArr = new Float32Array(Math.max(16, scaff.length * 2) * 7);
      const buf = new THREE.InstancedInterleavedBuffer(this.scaffoldArr, 7, 1).setUsage(THREE.DynamicDrawUsage);
      this.scaffoldGeo.dispose(); // forget the cached instance count (see ensure())
      this.scaffoldGeo.setAttribute('aDir', new THREE.InterleavedBufferAttribute(buf, 3, 0));
      this.scaffoldGeo.setAttribute('aInst', new THREE.InterleavedBufferAttribute(buf, 4, 3));
    }
    scaff.forEach((idx, k) => {
      const b = civ.buildings[idx];
      const o = k * 7;
      const r = BUILDINGS[b.type].radius;
      this.scaffoldArr[o] = b.x; this.scaffoldArr[o + 1] = b.y; this.scaffoldArr[o + 2] = b.z;
      this.scaffoldArr[o + 3] = groundHeight(data.heights, data.n, b.x, b.y, b.z);
      this.scaffoldArr[o + 4] = b.rot;
      this.scaffoldArr[o + 5] = r * 0.8;
      this.scaffoldArr[o + 6] = 1 + r * 0.3;
    });
    this.scaffoldGeo.instanceCount = scaff.length;
    const sAttr = this.scaffoldGeo.getAttribute('aDir') as THREE.InterleavedBufferAttribute | undefined;
    if (sAttr) { sAttr.data.clearUpdateRanges(); sAttr.data.addUpdateRange(0, scaff.length * 7); sAttr.data.needsUpdate = true; }
    // Roads (rebuild only when the building set changed).
    if (civ.version !== this.lastVersion) {
      this.lastVersion = civ.version;
      this.buildRoads(civ.roads);
    }
  }

  private buildRoads(roads: Float32Array): void {
    if (this.roadMesh) { this.group.remove(this.roadMesh); this.roadMesh.geometry.dispose(); this.roadMesh = null; }
    const n = roads.length / 7;
    if (n === 0) return;
    const pos: number[] = [], lvl: number[] = [], side: number[] = [], idx: number[] = [];
    for (let k = 0; k < n; k++) {
      const ax = roads[k * 7], ay = roads[k * 7 + 1], az = roads[k * 7 + 2];
      const bx = roads[k * 7 + 3], by = roads[k * 7 + 4], bz = roads[k * 7 + 5];
      const level = roads[k * 7 + 6];
      const len = Math.acos(Math.min(1, ax * bx + ay * by + az * bz)) * PLANET_RADIUS;
      const steps = Math.max(2, Math.ceil(len / 1.5));
      // Side vector: (a × b) normalised.
      let sx = ay * bz - az * by, sy = az * bx - ax * bz, sz = ax * by - ay * bx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const w = (0.9 + level * 0.25) / PLANET_RADIUS;
      sx = (sx / sl) * w; sy = (sy / sl) * w; sz = (sz / sl) * w;
      const base = pos.length / 3;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        let x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
        const l = Math.hypot(x, y, z);
        x /= l; y /= l; z /= l;
        for (const sd of [-1, 1]) {
          pos.push((x + sx * sd) * PLANET_RADIUS, (y + sy * sd) * PLANET_RADIUS, (z + sz * sd) * PLANET_RADIUS);
          lvl.push(level);
          side.push(sd);
        }
        if (i < steps) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aLevel', new THREE.Float32BufferAttribute(lvl, 1));
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    geo.setIndex(idx);
    this.roadMesh = new THREE.Mesh(geo, this.roadMat);
    this.roadMesh.frustumCulled = false;
    this.roadMesh.renderOrder = 3;
    this.group.add(this.roadMesh);
  }
}
