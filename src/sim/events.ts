/**
 * Simulation event bus. Systems emit events describing notable happenings;
 * the worker streams them to the main thread where they feed the chronicle,
 * notifications, the auto-director camera and the audio engine. Events are
 * plain data (serialisable) and part of the saved world history.
 */

export type EventKind =
  // weather & planet
  | 'storm' | 'hurricane' | 'landfall' | 'blizzard' | 'lightning' | 'drought' | 'drought-end'
  | 'wildfire' | 'flood' | 'eruption' | 'quake' | 'tsunami' | 'meteor' | 'ice-age' | 'thaw'
  // ecology
  | 'extinction' | 'speciation' | 'boom' | 'crash' | 'epidemic' | 'migration'
  // civilisation
  | 'tribe-founded' | 'settlement-founded' | 'settlement-grew' | 'settlement-abandoned' | 'building'
  | 'tech' | 'age' | 'birth-notable' | 'death-notable' | 'famine' | 'plague' | 'trade-route'
  | 'war' | 'peace' | 'alliance' | 'betrayal' | 'battle' | 'siege' | 'conquest' | 'refugees'
  | 'prophet' | 'schism' | 'holy-war' | 'sacred-site' | 'religion' | 'monument' | 'discovery' | 'first-contact'
  // divine
  | 'power' | 'miracle' | 'omen'
  // meta
  | 'scenario' | 'milestone';

export interface GameEvent {
  id: number;
  tick: number;
  kind: EventKind;
  /** Location (unit direction) or 0,0,0 for global events. */
  x: number;
  y: number;
  z: number;
  /** 0..1: how notable (drives chronicle inclusion and auto-director). */
  importance: number;
  /** Free-form structured payload (names, ids, counts). */
  data: Record<string, string | number>;
}

export class EventLog {
  private nextId = 1;
  /** Events not yet delivered to the main thread. */
  pending: GameEvent[] = [];
  /** Retained history of important events (chronicle source). */
  history: GameEvent[] = [];
  historyLimit = 6000;

  emit(tick: number, kind: EventKind, pos: { x: number; y: number; z: number } | null, importance: number, data: Record<string, string | number> = {}): GameEvent {
    const e: GameEvent = {
      id: this.nextId++,
      tick,
      kind,
      x: pos ? pos.x : 0,
      y: pos ? pos.y : 0,
      z: pos ? pos.z : 0,
      importance,
      data,
    };
    this.pending.push(e);
    if (importance >= 0.3) {
      this.history.push(e);
      if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
    }
    return e;
  }

  drain(): GameEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  serialize(): { nextId: number; history: GameEvent[] } {
    return { nextId: this.nextId, history: this.history };
  }

  deserialize(s: { nextId: number; history: GameEvent[] }): void {
    this.nextId = s.nextId;
    this.history = s.history;
    this.pending = [];
  }
}
