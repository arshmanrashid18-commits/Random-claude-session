/** A lyrical proper name for a world, derived from its seed. */
import { Rng } from './rng';

const STARTS = ['Ae', 'Al', 'Ar', 'Ca', 'El', 'Ise', 'Ka', 'Lu', 'Mi', 'Ny', 'Or', 'Sa', 'Tha', 'Ve', 'Yl', 'Za', 'Eo', 'Ith', 'Mor', 'Sel'];
const MIDS = ['ra', 'li', 'the', 'no', 'vi', 'ma', 'ri', 'lo', 'sa', 'dri', 'e', 'a', 'ne', 'ru', 'thi'];
const ENDS = ['a', 'is', 'on', 'ia', 'ara', 'eth', 'or', 'une', 'yr', 'ael', 'ea', 'os', 'ir', 'enne'];

export function worldName(seed: number): string {
  const r = new Rng((seed ^ 0x5eed1e) >>> 0);
  let name = r.pick(STARTS);
  const mids = r.int(1, 3);
  for (let i = 0; i < mids; i++) name += r.pick(MIDS);
  name += r.pick(ENDS);
  return name.replace(/([aeiouy])\1+/g, '$1');
}
