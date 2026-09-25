/**
 * Turns simulation events into prose: short headlines for the event feed and
 * fuller sentences for the Chronicle. Pure functions of event data.
 */
import type { GameEvent } from '../sim/events';
import { TICKS_PER_YEAR, DAYS_PER_YEAR, TICKS_PER_DAY, SEASON_NAMES } from '../sim/constants';

export type Tone = 'divine' | 'good' | 'bad' | 'war' | 'nature' | 'neutral';

export interface Narration {
  title: string;
  text: string;
  icon: string;
  tone: Tone;
}

const s = (v: unknown) => String(v ?? '');
const n = (v: unknown) => Number(v ?? 0);

export function yearOfTick(tick: number): number {
  return Math.floor(tick / TICKS_PER_YEAR) + 1;
}

export function dateOfTick(tick: number): string {
  const year = yearOfTick(tick);
  const day = Math.floor(tick / TICKS_PER_DAY) % DAYS_PER_YEAR;
  const season = SEASON_NAMES[Math.floor((day / DAYS_PER_YEAR) * 4) % 4];
  return `Year ${year}, ${season.toLowerCase()}`;
}

const CAUSE_WORDS: Record<string, string> = {
  border: 'over disputed borders', holy: 'in the name of their god', revenge: 'to avenge old wrongs', conquest: 'hungry for land',
  betrayal: 'breaking their oath', alliance: 'to honour an alliance', rebellion: 'against the rebels',
};

export function narrate(e: GameEvent): Narration {
  const d = e.data;
  switch (e.kind) {
    case 'power': {
      const combo = s(d.combo);
      return { title: combo || s(d.name), text: combo ? `${s(d.name)} became ${combo} at ${s(d.where)}.` : `You cast ${s(d.name)} upon ${s(d.where)}.`, icon: s(d.power), tone: 'divine' };
    }
    case 'miracle':
      if (d.kind === 'resurrection') return { title: 'The dead rise', text: `${n(d.count)} walk again${d.names ? ` — ${s(d.names)} among them` : ''}.`, icon: 'resurrection', tone: 'divine' };
      if (d.kind === 'inspiration') return { title: 'A spark of genius', text: `The ${s(d.tribe)} of ${s(d.settlement)} dream of new things${d.sage ? `; ${s(d.sage)} becomes a sage` : ''}.`, icon: 'inspiration', tone: 'divine' };
      return { title: s(d.name), text: s(d.desc), icon: 'sparkle', tone: 'divine' };
    case 'omen':
      if (d.kind === 'eclipse') return { title: 'Eclipse', text: 'The sun is devoured at noon. Every people on the world falls to its knees.', icon: 'eclipse', tone: 'divine' };
      return { title: 'A light in the sky', text: 'A new star burns brighter by the moment, falling toward the world.', icon: 'meteor', tone: 'divine' };
    case 'meteor': return { title: 'Impact', text: `A star fell upon ${s(d.where)}${n(d.deaths) ? `, killing ${n(d.deaths)}` : ''}${d.ocean ? ' and the sea rose in answer' : ''}.`, icon: 'meteor', tone: 'bad' };
    case 'quake': return { title: 'Earthquake', text: `The earth shook at ${s(d.where)}${n(d.ruined) ? `; ${n(d.ruined)} buildings fell` : ''}${n(d.deaths) ? ` and ${n(d.deaths)} died` : ''}.`, icon: 'earthquake', tone: 'bad' };
    case 'eruption': return { title: 'Eruption', text: `A volcano tears open at ${s(d.where)}.`, icon: 'volcano', tone: 'bad' };
    case 'tsunami': return { title: 'Tsunami', text: `A great wave races out from ${s(d.where)}.`, icon: 'tsunami', tone: 'bad' };
    case 'flood':
      if (d.swallowed) return { title: 'Swallowed by the sea', text: `${s(d.settlement)} of the ${s(d.tribe)} is lost beneath the water.`, icon: 'flood', tone: 'bad' };
      return { title: 'Flood', text: `Floodwater drowns the coasts of ${s(d.where)}${n(d.deaths) ? `; ${n(d.deaths)} are lost` : ''}.`, icon: 'flood', tone: 'bad' };
    case 'ice-age': return { title: 'An ice age begins', text: 'The sun dims. Ice creeps from the poles; the world grows cold.', icon: 'iceage', tone: 'bad' };
    case 'thaw': return { title: 'The great thaw', text: 'Warmth returns to the world; the ice retreats toward the poles.', icon: 'sun', tone: 'good' };
    case 'drought':
      if (d.divine) return { title: 'Drought', text: `You close the sky over ${s(d.where)}.`, icon: 'drought', tone: 'bad' };
      return { title: 'Drought', text: `Drought grips ${s(d.continent)} (${n(d.severity)}% of the land parched).`, icon: 'drought', tone: 'nature' };
    case 'drought-end': return { title: 'Rains return', text: `The drought over ${s(d.continent)} breaks.`, icon: 'rain', tone: 'good' };
    case 'wildfire': return { title: 'Wildfire', text: `Fire sweeps across ${s(d.where)}.`, icon: 'wildfire', tone: 'nature' };
    case 'hurricane': return { title: `Hurricane ${s(d.name)}`, text: `A hurricane named ${s(d.name)} spins up over the ocean.`, icon: 'storm', tone: 'nature' };
    case 'landfall': return { title: `${s(d.name)} makes landfall`, text: `Hurricane ${s(d.name)} (category ${n(d.category)}) strikes ${s(d.continent) || 'the coast'}.`, icon: 'storm', tone: 'nature' };
    case 'blizzard': return { title: 'Blizzard', text: `A blizzard howls across the high latitudes.`, icon: 'iceage', tone: 'nature' };
    case 'storm': return { title: 'Storm', text: 'A storm front rolls in.', icon: 'storm', tone: 'nature' };
    case 'extinction': return { title: 'Extinction', text: `The last of the ${s(d.plural)} is gone. They will never return.`, icon: 'skull', tone: 'bad' };
    case 'speciation': return { title: 'A new species', text: `Isolated ${s(d.parent)} ${d.where ? `in ${s(d.where)} ` : ''}have become something new: the ${s(d.species)}.`, icon: 'paw', tone: 'good' };
    case 'epidemic': return { title: 'Murrain', text: `Disease spreads among the ${s(d.species)} of ${s(d.where)}.`, icon: 'plague', tone: 'nature' };
    case 'tribe-founded': return { title: `The ${s(d.tribe)}`, text: `The ${s(d.tribe)} make their first camp at ${s(d.settlement)}, in ${s(d.where)}.`, icon: 'flag', tone: 'neutral' };
    case 'settlement-founded': return { title: 'A new settlement', text: `The ${s(d.tribe)} found ${s(d.settlement)} in ${s(d.where)}.`, icon: 'house', tone: 'good' };
    case 'settlement-grew': return { title: `${s(d.settlement)} grows`, text: `${s(d.settlement)} of the ${s(d.tribe)} becomes a ${['camp', 'village', 'town', 'city'][n(d.tier)] ?? 'city'}.`, icon: 'house', tone: 'good' };
    case 'settlement-abandoned': return { title: d.last ? 'A people vanishes' : 'Abandoned', text: d.last ? `With ${s(d.settlement)} abandoned, the ${s(d.tribe)} are no more.` : `${s(d.settlement)} of the ${s(d.tribe)} stands empty.`, icon: 'skull', tone: 'bad' };
    case 'migration': return { title: 'Settlers depart', text: `${n(d.count)} settlers leave ${s(d.settlement)} for ${s(d.to)}.`, icon: 'people', tone: 'neutral' };
    case 'building': return { title: s(d.building), text: `${s(d.settlement)} completes a ${s(d.building).toLowerCase()}.`, icon: 'house', tone: 'neutral' };
    case 'monument': return { title: 'A monument rises', text: `The ${s(d.tribe)} of ${s(d.settlement)} raise a great monument.`, icon: 'temple', tone: 'good' };
    case 'tech': return { title: s(d.tech), text: `The ${s(d.tribe)} discover ${s(d.tech).toLowerCase()}: ${s(d.desc).toLowerCase()}`, icon: 'tech', tone: 'good' };
    case 'age': return { title: s(d.age), text: `The ${s(d.tribe)} enter the ${s(d.age)}.`, icon: 'crown', tone: 'good' };
    case 'birth-notable': return d.role === 'hero'
      ? { title: 'A hero', text: `${s(d.name)} of the ${s(d.tribe)} is hailed a hero of battle.`, icon: 'sword', tone: 'war' }
      : { title: 'A new chief', text: `${s(d.name)} becomes chief of the ${s(d.tribe)}.`, icon: 'crown', tone: 'neutral' };
    case 'death-notable': return { title: 'A great one dies', text: `${s(d.name)} of the ${s(d.tribe)} dies${d.cause && d.cause !== 'old age' ? ` of ${s(d.cause)}` : ' of old age'} at ${n(d.age)}.`, icon: 'skull', tone: 'neutral' };
    case 'famine': return { title: 'Famine', text: `Hunger stalks ${s(d.settlement)}.`, icon: 'skull', tone: 'bad' };
    case 'plague': return { title: 'Plague', text: `Sickness spreads through ${s(d.settlement)} of the ${s(d.tribe)}${d.divine ? ', sent by your hand' : ''}.`, icon: 'plague', tone: 'bad' };
    case 'trade-route':
      if (d.pact) return { title: 'Trade pact', text: `The ${s(d.a)} and the ${s(d.b)} agree to trade.`, icon: 'scroll', tone: 'good' };
      if (d.sea) return { title: 'Sea route', text: `Ships begin sailing between ${s(d.a)} and ${s(d.b)}.`, icon: 'wave', tone: 'good' };
      return { title: 'First caravan', text: `A caravan sets out from ${s(d.a)} for ${s(d.b)}.`, icon: 'scroll', tone: 'good' };
    case 'first-contact': return { title: 'First contact', text: `The ${s(d.a)} and the ${s(d.b)} meet for the first time.`, icon: 'people', tone: 'neutral' };
    case 'alliance': return { title: 'Alliance', text: `The ${s(d.a)} and the ${s(d.b)} swear an alliance.`, icon: 'heart', tone: 'good' };
    case 'betrayal': return { title: 'Betrayal', text: `The ${s(d.traitor)} betray their allies, the ${s(d.victim)}.`, icon: 'sword', tone: 'war' };
    case 'war': return { title: 'War', text: `The ${s(d.a)} go to war with the ${s(d.b)} ${CAUSE_WORDS[s(d.cause)] ?? ''}.`.replace(' .', '.'), icon: 'sword', tone: 'war' };
    case 'holy-war': return { title: 'Holy war', text: `The ${s(d.a)} declare a holy war upon the ${s(d.b)}.`, icon: 'sword', tone: 'war' };
    case 'peace': return { title: d.how === 'truce' ? 'Truce' : 'Peace', text: `The war between the ${s(d.a)} and the ${s(d.b)} ends${n(d.deaths) ? ` after ${n(d.deaths)} deaths` : ''}.`, icon: 'harmony', tone: 'good' };
    case 'battle':
      if (d.stage === 'muster') return { title: 'Warriors gather', text: `The ${s(d.a)} muster ${n(d.size)} warriors against ${s(d.target)}.`, icon: 'sword', tone: 'war' };
      if (d.stage === 'march') return { title: 'On the march', text: `An army of the ${s(d.a)} marches on ${s(d.target)}.`, icon: 'sword', tone: 'war' };
      return { title: 'Battle', text: `The ${s(d.a)} fall upon ${s(d.settlement)} of the ${s(d.b)}.`, icon: 'sword', tone: 'war' };
    case 'siege': return { title: 'Siege', text: `The ${s(d.a)} lay siege to the walls of ${s(d.settlement)}.`, icon: 'sword', tone: 'war' };
    case 'conquest': return d.destroyed
      ? { title: 'A people conquered', text: `With the fall of ${s(d.settlement)}, the ${s(d.loser)} are no more.`, icon: 'skull', tone: 'war' }
      : { title: 'Conquest', text: `The ${s(d.winner)} take ${s(d.settlement)} from the ${s(d.loser)}.`, icon: 'crown', tone: 'war' };
    case 'refugees': return { title: 'Refugees', text: `${n(d.count)} ${s(d.tribe)} flee ${s(d.from)} for ${s(d.to)}.`, icon: 'people', tone: 'bad' };
    case 'prophet': return { title: 'A prophet', text: `${s(d.name)} of ${s(d.settlement)} has seen your face${d.kind === 'saint' ? ' and is called a saint' : d.kind === 'doom' ? ' and speaks of doom' : ''}.`, icon: 'prophet', tone: 'divine' };
    case 'schism': return { title: 'Schism', text: `${s(d.settlement)} breaks from the ${s(d.parent)}, following ${s(d.faith)} as the ${s(d.tribe)}.`, icon: 'temple', tone: 'war' };
    case 'religion':
      if (d.converted) return { title: 'Conversion', text: `The ${s(d.tribe)} turn to ${s(d.faith)}, moved by ${s(d.prophet)}.`, icon: 'temple', tone: 'divine' };
      return { title: 'A new name', text: `The ${s(d.tribe)} now call you ${s(d.deity)}.`, icon: 'temple', tone: 'divine' };
    case 'sacred-site': return { title: 'Sacred ground', text: `The ${s(d.tribe)} hold ${s(d.origin)} sacred.`, icon: 'sanctuary', tone: 'divine' };
    case 'scenario': return { title: s(d.title), text: s(d.text), icon: 'flag', tone: 'neutral' };
    case 'milestone': return { title: s(d.title), text: s(d.text), icon: 'sparkle', tone: 'good' };
    default: return { title: e.kind, text: '', icon: 'sparkle', tone: 'neutral' };
  }
}
