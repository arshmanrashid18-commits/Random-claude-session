/**
 * Tiny procedural mesh toolkit: appends primitives with transforms, vertex
 * colours and extra per-vertex attributes (wind sway weight, construction
 * order, body part) into one BufferGeometry. Every model in the game is built
 * with this at startup – there are no external assets.
 */
import * as THREE from 'three';

export interface PartOpts {
  /** Vertex colour (ignored when slot > 0; defaults to white). */
  color?: [number, number, number];
  /** Wind sway weight (0 rigid .. 1 fully flexible). */
  sway?: number;
  /** Extra per-vertex scalar (construction order, limb id, ...). */
  tag?: number;
  /** Colour jitter per vertex (0..1). */
  jitter?: number;
  /** Darken toward the bottom of the part (fake AO), 0..1. */
  ao?: number;
  flat?: boolean;
  /** Rotation pivot for animated parts (legs, head, tail). */
  pivot?: [number, number, number];
  /** Colour slot: 0 = vertex colour, 1 = instance primary, 2 = instance secondary. */
  slot?: number;
}

export class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  sway: number[] = [];
  tag: number[] = [];
  pivot: number[] = [];
  slot: number[] = [];
  idx: number[] = [];
  private seed = 1;

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Append raw triangles from a three.js geometry with a transform. */
  addGeometry(g: THREE.BufferGeometry, m: THREE.Matrix4, o: PartOpts): this {
    const geo = o.flat && g.getIndex() ? g.toNonIndexed() : g;
    if (o.flat) {
      if (geo === g) { g.deleteAttribute('normal'); }
      geo.computeVertexNormals();
    }
    const p = geo.getAttribute('position');
    const nAttr = geo.getAttribute('normal');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const base = this.pos.length / 3;
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i));
      const ly = (v.y - minY) / Math.max(1e-6, maxY - minY);
      v.applyMatrix4(m);
      n.set(nAttr.getX(i), nAttr.getY(i), nAttr.getZ(i)).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      const j = o.jitter ? 1 + (this.rand() - 0.5) * o.jitter : 1;
      const ao = o.ao ? 1 - o.ao * (1 - ly) : 1;
      const col = o.color ?? [1, 1, 1];
      this.col.push(col[0] * j * ao, col[1] * j * ao, col[2] * j * ao);
      this.sway.push(o.sway ?? 0);
      this.tag.push(o.tag ?? 0);
      const pv = o.pivot ?? [0, 0, 0];
      this.pivot.push(pv[0], pv[1], pv[2]);
      this.slot.push(o.slot ?? 0);
    }
    const index = geo.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    if (geo !== g) geo.dispose();
    return this;
  }

  cylinder(rTop: number, rBot: number, h: number, seg: number, at: THREE.Vector3, o: PartOpts, rot?: THREE.Euler): this {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false);
    g.translate(0, h / 2, 0);
    const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), new THREE.Vector3(1, 1, 1));
    this.addGeometry(g, m, o);
    g.dispose();
    return this;
  }

  cone(r: number, h: number, seg: number, at: THREE.Vector3, o: PartOpts, rot?: THREE.Euler): this {
    const g = new THREE.ConeGeometry(r, h, seg, 1, false);
    g.translate(0, h / 2, 0);
    const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), new THREE.Vector3(1, 1, 1));
    this.addGeometry(g, m, o);
    g.dispose();
    return this;
  }

  blob(r: number, detail: number, at: THREE.Vector3, scale: THREE.Vector3, o: PartOpts, noise = 0.18): this {
    const g = new THREE.IcosahedronGeometry(r, detail);
    // Deterministic lumpy deformation.
    const p = g.getAttribute('position');
    const map = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
      let k = map.get(key);
      if (k === undefined) { k = 1 + (this.rand() - 0.5) * noise * 2; map.set(key, k); }
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    const m = new THREE.Matrix4().compose(at, new THREE.Quaternion(), scale);
    this.addGeometry(g, m, o);
    g.dispose();
    return this;
  }

  /** Tapered cylinder from point a to point b. */
  segment(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, seg: number, o: PartOpts): this {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1, false);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1));
    this.addGeometry(g, m, o);
    g.dispose();
    return this;
  }

  box(w: number, h: number, d: number, at: THREE.Vector3, o: PartOpts, rot?: THREE.Euler): this {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), new THREE.Vector3(1, 1, 1));
    this.addGeometry(g, m, o);
    g.dispose();
    return this;
  }

  /** Triangular prism roof along X: width w (X), depth d (Z), height h. */
  roof(w: number, d: number, h: number, at: THREE.Vector3, o: PartOpts, rot?: THREE.Euler, overhang = 0.15): this {
    const hw = w / 2 + overhang, hd = d / 2 + overhang;
    const shape = new THREE.BufferGeometry();
    const v = [
      // two slopes
      -hw, 0, -hd, hw, 0, -hd, hw, h, 0, -hw, 0, -hd, hw, h, 0, -hw, h, 0,
      -hw, 0, hd, -hw, h, 0, hw, h, 0, -hw, 0, hd, hw, h, 0, hw, 0, hd,
      // gables
      -hw, 0, -hd, -hw, h, 0, -hw, 0, hd,
      hw, 0, -hd, hw, 0, hd, hw, h, 0,
    ];
    shape.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    shape.computeVertexNormals();
    const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), new THREE.Vector3(1, 1, 1));
    this.addGeometry(shape, m, o);
    shape.dispose();
    return this;
  }

  /** Double-sided flat quad (leaf, frond, flag, blade). */
  quad(w: number, h: number, at: THREE.Vector3, rot: THREE.Euler, o: PartOpts, bend = 0): this {
    const g = new THREE.PlaneGeometry(w, h, 1, 3);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + h / 2;
      p.setY(i, y);
      p.setZ(i, bend * (y / h) * (y / h) * h);
    }
    g.computeVertexNormals();
    const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(1, 1, 1));
    this.addGeometry(g, m, o);
    // back face
    const g2 = g.clone();
    const idx = g2.getIndex()!;
    const arr = idx.array as Uint16Array;
    for (let i = 0; i < arr.length; i += 3) { const t = arr[i]; arr[i] = arr[i + 2]; arr[i + 2] = t; }
    const n = g2.getAttribute('normal');
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    this.addGeometry(g2, m, o);
    g.dispose();
    g2.dispose();
    return this;
  }

  /**
   * A drooping, folded leaf (palm frond, banana leaf): the midrib rises at
   * `lift` radians and bends down by `droop` along its length; the blade
   * tapers at both ends and is folded into a shallow V. Double-sided.
   * Built along local +Z, then rotated about the trunk by `yaw`.
   */
  leaf(len: number, width: number, lift: number, droop: number, at: THREE.Vector3, yaw: number, o: PartOpts, segs = 8): this {
    const pos: number[] = [];
    const idx: number[] = [];
    let px = 0, py = 0, pz = 0;
    const dl = len / segs;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const pitch = lift - droop * t * t;
      const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.04)), 0.6) * (1 - 0.25 * t);
      const fold = w * 0.45;
      // Side vector is +X; the blade edges droop below the midrib.
      pos.push(px - w, py - fold, pz, px, py, pz, px + w, py - fold, pz);
      if (i < segs) {
        const b = i * 3;
        idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5);
      }
      py += Math.sin(pitch) * dl;
      pz += Math.cos(pitch) * dl;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
    this.addGeometry(g, m, o);
    const g2 = g.clone();
    const ia = g2.getIndex()!.array as Uint16Array;
    for (let i = 0; i < ia.length; i += 3) { const t = ia[i]; ia[i] = ia[i + 2]; ia[i + 2] = t; }
    const n = g2.getAttribute('normal');
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    this.addGeometry(g2, m, o);
    g.dispose();
    g2.dispose();
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setAttribute('aTag', new THREE.Float32BufferAttribute(this.tag, 1));
    g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.pivot, 3));
    g.setAttribute('aSlot', new THREE.Float32BufferAttribute(this.slot, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** sRGB hex → linear RGB triple. */
export function lin(hex: number): [number, number, number] {
  // THREE.Color converts sRGB hex input to the linear working space.
  const c = new THREE.Color().setHex(hex);
  return [c.r, c.g, c.b];
}
