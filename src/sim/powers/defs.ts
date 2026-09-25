/**
 * Divine power definitions shared by the simulation (effects, costs,
 * cooldowns) and the UI (power bar, tooltips, targeting reticle).
 */

export type PowerId =
  | 'lightning' | 'rain' | 'drought' | 'wildfire' | 'iceage'
  | 'earthquake' | 'volcano' | 'tsunami' | 'meteor'
  | 'bloom' | 'blessing' | 'plague' | 'resurrection' | 'locusts'
  | 'inspiration' | 'prophet' | 'harmony' | 'beacon' | 'eclipse' | 'sanctuary';

export type PowerSchool = 'sky' | 'earth' | 'life' | 'spirit';

/** Where a power may be aimed. */
export type PowerTarget = 'any' | 'land' | 'ocean' | 'settlement' | 'global';

export interface PowerDef {
  id: PowerId;
  name: string;
  school: PowerSchool;
  /** Devotion cost. */
  cost: number;
  /** Cooldown in simulation ticks. */
  cooldown: number;
  /** Area of effect radius in world units (0 = point / global). */
  radius: number;
  target: PowerTarget;
  /** Is it usually a gift (love) or a terror (fear)? −1..1 */
  mood: number;
  /** Short description for tooltips. */
  desc: string;
  /** What it does to the world, in plain words. */
  effect: string;
  /** Accent colour for UI and VFX. */
  color: number;
  /** Default hotkey. */
  key: string;
}

export const POWERS: PowerDef[] = [
  { id: 'lightning', name: 'Lightning', school: 'sky', cost: 6, cooldown: 3, radius: 4, target: 'any', mood: -0.4, key: 'Digit1',
    desc: 'Hurl a bolt from the heavens.', effect: 'Strikes one spot: kills what stands there and can start fires. Mortals remember it with dread.', color: 0xbfd8ff },
  { id: 'rain', name: 'Rain', school: 'sky', cost: 20, cooldown: 24, radius: 70, target: 'any', mood: 0.5, key: 'Digit2',
    desc: 'Gather clouds and let them weep.', effect: 'Two days of rain: soils soak, rivers swell, fires die. Breaking a drought earns deep gratitude.', color: 0x7fb4ff },
  { id: 'drought', name: 'Drought', school: 'sky', cost: 45, cooldown: 160, radius: 150, target: 'land', mood: -0.5, key: 'Digit3',
    desc: 'Close the sky over a land.', effect: 'For a year little rain falls. Plants wither, harvests fail, herds move on, fires spread.', color: 0xe0a35a },
  { id: 'wildfire', name: 'Wildfire', school: 'sky', cost: 18, cooldown: 30, radius: 20, target: 'land', mood: -0.6, key: 'Digit4',
    desc: 'Set the forest ablaze.', effect: 'Ignites the land. Fire spreads with wind and dryness, leaving ash that later feeds new growth.', color: 0xff7a2e },
  { id: 'iceage', name: 'Ice Age', school: 'sky', cost: 600, cooldown: 4800, radius: 0, target: 'global', mood: -0.7, key: '',
    desc: 'Dim the sun for a generation.', effect: 'The whole world cools by nine degrees for six years. Ice spreads from the poles; life retreats to the equator.', color: 0xcfefff },
  { id: 'earthquake', name: 'Earthquake', school: 'earth', cost: 110, cooldown: 240, radius: 60, target: 'land', mood: -0.8, key: 'Digit5',
    desc: 'Shake the bones of the world.', effect: 'Topples buildings, tears a fault scarp across the land. At sea it raises a tsunami.', color: 0xc08a5a },
  { id: 'volcano', name: 'Volcano', school: 'earth', cost: 320, cooldown: 960, radius: 45, target: 'land', mood: -0.9, key: 'Digit6',
    desc: 'Open the mountain of fire.', effect: 'Raises a volcano that erupts for days: lava, fire, ash skies that cool the region. Ash becomes fertile soil.', color: 0xff5a1f },
  { id: 'tsunami', name: 'Tsunami', school: 'earth', cost: 260, cooldown: 720, radius: 140, target: 'ocean', mood: -0.9, key: 'Digit7',
    desc: 'Heave the sea against the shore.', effect: 'A great wave races outward and floods low coasts, sweeping away people, farms and boats.', color: 0x4fd0e0 },
  { id: 'meteor', name: 'Meteor', school: 'earth', cost: 480, cooldown: 1440, radius: 40, target: 'any', mood: -1, key: 'Digit8',
    desc: 'Call down a star.', effect: 'A fireball from the sky: a crater, a ring of fire, and a winter of dust. At sea it raises a tsunami.', color: 0xffc26b },
  { id: 'bloom', name: 'Fertile Bloom', school: 'life', cost: 55, cooldown: 120, radius: 80, target: 'land', mood: 0.8, key: 'KeyZ',
    desc: 'Wake every seed at once.', effect: 'Plants flourish and flower, soil deepens, herds breed and farms ripen early.', color: 0x9be36b },
  { id: 'blessing', name: 'Blessing', school: 'life', cost: 45, cooldown: 120, radius: 30, target: 'settlement', mood: 1, key: 'KeyX',
    desc: 'Lay your hand upon a people.', effect: 'Heals the sick, gladdens hearts and makes work light for a year. Their love for you deepens.', color: 0xffe08a },
  { id: 'plague', name: 'Plague', school: 'life', cost: 70, cooldown: 480, radius: 30, target: 'any', mood: -0.9, key: 'KeyC',
    desc: 'Breathe sickness into a place.', effect: 'Disease takes hold and spreads from person to person, and along roads and trade routes. Animals catch murrain.', color: 0x9ccf4a },
  { id: 'resurrection', name: 'Resurrection', school: 'life', cost: 140, cooldown: 480, radius: 45, target: 'any', mood: 1, key: 'KeyV',
    desc: 'Call the recently dead back to life.', effect: 'Those who died here within the last year walk again. Few things inspire such love.', color: 0xfff4d0 },
  { id: 'locusts', name: 'Locust Swarm', school: 'life', cost: 60, cooldown: 360, radius: 60, target: 'land', mood: -0.6, key: 'KeyB',
    desc: 'Loose a devouring cloud.', effect: 'A swarm drifts with the wind for two days, stripping fields and grassland bare.', color: 0x8a7a3a },
  { id: 'inspiration', name: 'Spark of Genius', school: 'spirit', cost: 90, cooldown: 480, radius: 30, target: 'settlement', mood: 0.6, key: 'KeyN',
    desc: 'Whisper an idea into a dreaming mind.', effect: 'A sage is born of the dream: the tribe completes its current research and learns faster for a time.', color: 0x9ad8ff },
  { id: 'prophet', name: 'Divine Vision', school: 'spirit', cost: 80, cooldown: 480, radius: 30, target: 'settlement', mood: 0.3, key: 'KeyM',
    desc: 'Show a mortal your face.', effect: 'Raises a prophet who preaches your name, spreading faith and sometimes founding new creeds.', color: 0xe8b6ff },
  { id: 'harmony', name: 'Harmony', school: 'spirit', cost: 120, cooldown: 720, radius: 400, target: 'any', mood: 0.7, key: '',
    desc: 'Still the hearts of warriors.', effect: 'Every tribe within reach lays down arms: wars end in truce and grudges soften.', color: 0xb8f0e0 },
  { id: 'beacon', name: 'Beacon', school: 'spirit', cost: 35, cooldown: 120, radius: 280, target: 'land', mood: 0.2, key: '',
    desc: 'Light a pillar that calls the living.', effect: 'Every beast within reach gathers at the beacon — the scattered last of a kind find each other — and wanderers take it as a sign to settle there.', color: 0xfff0a0 },
  { id: 'eclipse', name: 'Eclipse', school: 'spirit', cost: 200, cooldown: 1920, radius: 0, target: 'global', mood: -0.3, key: '',
    desc: 'Draw the moon across the sun.', effect: 'Darkness at noon. Every people falls to its knees; fear and devotion surge across the world.', color: 0xff9a5a },
  { id: 'sanctuary', name: 'Sacred Grove', school: 'spirit', cost: 60, cooldown: 240, radius: 25, target: 'land', mood: 0.6, key: '',
    desc: 'Consecrate a place forever.', effect: 'Ancient trees rise, animals there cannot be hunted, and the nearest people make pilgrimages to it.', color: 0x7de0a0 },
];

export const POWER_INDEX = new Map<PowerId, number>(POWERS.map((p, i) => [p.id, i]));

export function powerDef(id: PowerId): PowerDef {
  return POWERS[POWER_INDEX.get(id)!];
}

export const SCHOOL_NAMES: Record<PowerSchool, string> = { sky: 'Sky', earth: 'Earth', life: 'Life', spirit: 'Spirit' };

/** Named combos: casting B on the lingering effect of A. */
export interface ComboDef {
  id: string;
  name: string;
  desc: string;
}

export const COMBOS: ComboDef[] = [
  { id: 'mercy', name: 'Mercy Rain', desc: 'Rain upon a drought: gratitude beyond words.' },
  { id: 'tempest', name: 'Tempest', desc: 'Lightning into rain clouds calls a chain of bolts.' },
  { id: 'firestorm', name: 'Firestorm', desc: 'Fire in a drought spreads twice as fiercely.' },
  { id: 'ashbloom', name: 'Ashen Bloom', desc: 'Bloom on volcanic ash: the richest soil in the world.' },
  { id: 'deluge', name: 'Deluge', desc: 'Rain upon rain floods the lowlands.' },
  { id: 'aftershock', name: 'Aftershock', desc: 'An earthquake beside a volcano wakes it again.' },
  { id: 'cure', name: 'Miracle Cure', desc: 'Blessing or resurrection upon the plague-stricken ends the plague.' },
  { id: 'saint', name: 'Saint', desc: 'A vision granted to a blessed people raises a saint.' },
  { id: 'omen', name: 'Dark Omen', desc: 'A vision during an eclipse: a prophecy of doom.' },
  { id: 'cataclysm', name: 'Cataclysm', desc: 'A meteor into the sea raises a tsunami.' },
];
