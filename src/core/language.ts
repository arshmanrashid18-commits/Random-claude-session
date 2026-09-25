/**
 * Procedural languages. Each culture gets a phoneme inventory, syllable
 * structure and small lexicon, so every name it produces (people, places,
 * gods, storms it suffers) shares a recognisable flavour.
 */
import { Rng } from './rng';

const CONSONANT_POOLS = [
  ['l', 'm', 'n', 'r', 's', 'v', 'y', 'th', 'w', 'h'],            // soft
  ['k', 'g', 't', 'd', 'r', 'z', 'kh', 'b', 'gr', 'dr'],           // harsh
  ['s', 'sh', 'z', 'ch', 'j', 'n', 'm', 't', 'r', 'y'],            // sibilant
  ['p', 't', 'k', 'l', 'm', 'n', 'h', 'w', 'r', 'f'],              // island
  ['b', 'd', 'g', 'v', 'z', 'r', 'l', 'n', 'm', 'st'],             // voiced
  ['q', 'x', 'k', 't', 'l', 'n', 'ts', 'tl', 'y', 'h'],            // clicky
];
const VOWEL_POOLS = [
  ['a', 'e', 'i', 'o', 'u'],
  ['a', 'o', 'u', 'aa', 'uu'],
  ['e', 'i', 'y', 'ae', 'ie'],
  ['a', 'e', 'i', 'o', 'u', 'ai', 'ou', 'ea'],
  ['a', 'a', 'e', 'o', 'ia', 'io'],
];
const PATTERNS = [
  ['CV', 'CVC', 'CV'],
  ['CV', 'CV', 'V', 'CVC'],
  ['CVC', 'CV', 'CVCC'],
  ['CV', 'VC', 'CVV'],
];
const PLACE_SUFFIX_POOLS = [
  ['heim', 'tal', 'mar', 'dun', 'holt'],
  ['ora', 'ena', 'ia', 'ana', 'ise'],
  ['khar', 'gard', 'zon', 'dor', 'grom'],
  ['wai', 'lua', 'nui', 'ka', 'mo'],
  ['stan', 'ova', 'grad', 'vik', 'burg'],
  ['tlan', 'xoc', 'pec', 'lli', 'qua'],
];

export const CONCEPTS = [
  'sky', 'earth', 'fire', 'water', 'sun', 'moon', 'star', 'storm', 'mountain', 'river', 'sea', 'forest',
  'life', 'death', 'spirit', 'mother', 'father', 'light', 'dark', 'stone', 'wind', 'ice', 'blood', 'dream',
  'people', 'home', 'war', 'peace', 'harvest', 'eye', 'voice', 'hand',
] as const;
export type Concept = (typeof CONCEPTS)[number];

export interface LanguageSpec {
  seed: number;
  consonants: string[];
  vowels: string[];
  patterns: string[];
  placeSuffixes: string[];
  lexicon: Record<string, string>;
}

export class Language {
  readonly spec: LanguageSpec;
  private rng: Rng;

  constructor(seed: number) {
    const rng = new Rng(seed ^ 0x1a96);
    const ci = rng.int(0, CONSONANT_POOLS.length);
    const consonants = [...CONSONANT_POOLS[ci]];
    // Borrow a couple of consonants from another pool for individuality.
    const other = CONSONANT_POOLS[(ci + 1 + rng.int(0, CONSONANT_POOLS.length - 1)) % CONSONANT_POOLS.length];
    consonants.push(rng.pick(other), rng.pick(other));
    const vowels = [...VOWEL_POOLS[rng.int(0, VOWEL_POOLS.length)]];
    const patterns = [...PATTERNS[rng.int(0, PATTERNS.length)]];
    const placeSuffixes = [...PLACE_SUFFIX_POOLS[ci % PLACE_SUFFIX_POOLS.length]];
    this.rng = new Rng(seed ^ 0x77e1);
    this.spec = { seed, consonants, vowels, patterns, placeSuffixes, lexicon: {} };
    for (const c of CONCEPTS) this.spec.lexicon[c] = this.word(1, 2);
  }

  static fromSpec(spec: LanguageSpec): Language {
    const l = new Language(spec.seed);
    (l as { spec: LanguageSpec }).spec = spec;
    return l;
  }

  private syllable(rng: Rng): string {
    const pat = rng.pick(this.spec.patterns);
    let out = '';
    for (const ch of pat) out += ch === 'C' ? rng.pick(this.spec.consonants) : rng.pick(this.spec.vowels);
    return out;
  }

  /** A word of min..max syllables using the internal rng. */
  word(min = 1, max = 3, rng: Rng = this.rng): string {
    const n = rng.int(min, max + 1);
    let w = '';
    for (let i = 0; i < n; i++) w += this.syllable(rng);
    // Collapse triple letters and awkward doubles.
    w = w.replace(/(.)\1\1+/g, '$1$1').replace(/^([^aeiouy])\1/, '$1');
    return w;
  }

  /** Deterministic name for an arbitrary integer key (e.g. person id). */
  nameFor(key: number, kind: 'person' | 'place' | 'tribe' | 'god' | 'storm' | 'species' = 'person'): string {
    const r = new Rng((this.spec.seed * 31 + key * 2654435761 + kind.length * 97) >>> 0);
    let w: string;
    switch (kind) {
      case 'place':
        w = this.word(1, 2, r) + (r.chance(0.6) ? r.pick(this.spec.placeSuffixes) : '');
        break;
      case 'tribe':
        w = this.word(2, 2, r);
        break;
      case 'god':
        w = this.word(2, 3, r);
        break;
      case 'storm':
        w = this.word(2, 2, r);
        break;
      case 'species':
        w = this.word(2, 3, r);
        break;
      default:
        w = this.word(1, 3, r);
    }
    return capitalize(w.slice(0, 14));
  }

  term(c: Concept): string {
    return this.spec.lexicon[c];
  }
}

export function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
