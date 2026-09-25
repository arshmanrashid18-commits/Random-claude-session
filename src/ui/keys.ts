/**
 * Rebindable keyboard actions. Bindings are KeyboardEvent.code values so they
 * follow physical key positions across layouts.
 */
import { POWERS } from '../sim/powers/defs';

export interface ActionDef {
  id: string;
  label: string;
  group: 'Time' | 'Camera' | 'Interface' | 'Powers';
  key: string;
}

export const ACTIONS: ActionDef[] = [
  { id: 'pause', label: 'Pause / resume', group: 'Time', key: 'Space' },
  { id: 'faster', label: 'Faster', group: 'Time', key: 'Period' },
  { id: 'slower', label: 'Slower', group: 'Time', key: 'Comma' },
  { id: 'speed1', label: 'Normal speed (1×)', group: 'Time', key: '' },
  { id: 'speed2', label: 'Fast (10×)', group: 'Time', key: '' },
  { id: 'speed3', label: 'Very fast (100×)', group: 'Time', key: '' },
  { id: 'timelapse', label: 'Cinematic time-lapse', group: 'Time', key: 'KeyT' },
  { id: 'panN', label: 'Pan north', group: 'Camera', key: 'KeyW' },
  { id: 'panS', label: 'Pan south', group: 'Camera', key: 'KeyS' },
  { id: 'panW', label: 'Pan west', group: 'Camera', key: 'KeyA' },
  { id: 'panE', label: 'Pan east', group: 'Camera', key: 'KeyD' },
  { id: 'rotL', label: 'Rotate left', group: 'Camera', key: 'KeyQ' },
  { id: 'rotR', label: 'Rotate right', group: 'Camera', key: 'KeyE' },
  { id: 'tiltUp', label: 'Tilt toward horizon', group: 'Camera', key: 'KeyR' },
  { id: 'tiltDown', label: 'Tilt toward ground', group: 'Camera', key: 'KeyF' },
  { id: 'zoomIn', label: 'Zoom in', group: 'Camera', key: 'Equal' },
  { id: 'zoomOut', label: 'Zoom out', group: 'Camera', key: 'Minus' },
  { id: 'home', label: 'View whole planet', group: 'Camera', key: 'KeyH' },
  { id: 'follow', label: 'Follow selection', group: 'Camera', key: 'KeyL' },
  { id: 'director', label: 'Auto-director', group: 'Camera', key: 'KeyO' },
  { id: 'photo', label: 'Photo mode', group: 'Camera', key: 'KeyP' },
  { id: 'wheel', label: 'Power wheel (hold)', group: 'Powers', key: 'KeyG' },
  { id: 'terraform', label: 'Terraform tools', group: 'Powers', key: 'KeyY' },
  { id: 'cancel', label: 'Cancel / close', group: 'Interface', key: 'Escape' },
  { id: 'chronicle', label: 'Chronicle', group: 'Interface', key: 'KeyJ' },
  { id: 'ecology', label: 'Ecology', group: 'Interface', key: 'KeyK' },
  { id: 'tribes', label: 'Peoples', group: 'Interface', key: 'KeyU' },
  { id: 'saves', label: 'Save & load', group: 'Interface', key: 'KeyI' },
  { id: 'quicksave', label: 'Quick save', group: 'Interface', key: 'F5' },
  { id: 'quickload', label: 'Quick load', group: 'Interface', key: 'F9' },
  { id: 'settings', label: 'Settings', group: 'Interface', key: 'F10' },
  { id: 'help', label: 'Controls & help', group: 'Interface', key: 'Slash' },
  { id: 'hideUi', label: 'Hide interface', group: 'Interface', key: 'Backquote' },
  { id: 'perf', label: 'Performance overlay', group: 'Interface', key: 'F3' },
  ...POWERS.filter((p) => p.key).map((p) => ({ id: `power:${p.id}`, label: p.name, group: 'Powers' as const, key: p.key })),
];

export class KeyMap {
  private map = new Map<string, string>(); // code -> action
  bindings: Record<string, string> = {};

  constructor(saved?: Record<string, string>) {
    for (const a of ACTIONS) this.bindings[a.id] = saved?.[a.id] ?? a.key;
    this.rebuild();
  }

  private rebuild(): void {
    this.map.clear();
    for (const [id, code] of Object.entries(this.bindings)) if (code) this.map.set(code, id);
  }

  action(code: string): string | undefined {
    return this.map.get(code);
  }

  keyOf(id: string): string {
    return this.bindings[id] ?? '';
  }

  bind(id: string, code: string): void {
    // A key can only do one thing: steal it from any other action.
    for (const [other, c] of Object.entries(this.bindings)) if (c === code && other !== id) this.bindings[other] = '';
    this.bindings[id] = code;
    this.rebuild();
  }

  reset(): void {
    for (const a of ACTIONS) this.bindings[a.id] = a.key;
    this.rebuild();
  }
}

/** Human-readable label for a key code. */
export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    Space: 'Space', Escape: 'Esc', Equal: '=', Minus: '−', Comma: ',', Period: '.', Slash: '/', Backquote: '`', Tab: 'Tab',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', ShiftLeft: 'Shift', BracketLeft: '[', BracketRight: ']',
  };
  return names[code] ?? code;
}
