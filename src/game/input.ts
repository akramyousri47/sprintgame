/**
 * Input: one action queue fed by three sources.
 *
 *   keyboard   P1 Space = react, A/D (or arrows) = feet, S = dip
 *              P2 ShiftRight = react, J/L = feet, K = dip
 *   gamepad    the first connected pad drives P1, the second P2
 *              south = react, west/east = feet, north = dip
 *   touch      on-screen zones for mobile, pressed from React
 *
 * Actions are queued with the timestamp of the physical event rather than the
 * frame, because reaction time and rhythm windows are measured in tens of
 * milliseconds — a tap that arrives between frames must not be quantised to
 * the frame boundary or every athlete would be a tenth of a second slower.
 */

export type RaceAction = 'react' | 'left' | 'right' | 'dip' | 'confirm' | 'back' | 'pause' | 'debug';

/** 0 = player one, 1 = player two */
export type PlayerId = 0 | 1;

export interface InputEvent {
  action: RaceAction;
  /** performance.now() in seconds, from the event that produced it */
  at: number;
  source: 'key' | 'pad' | 'touch';
  player: PlayerId;
}

interface Binding {
  action: RaceAction;
  player: PlayerId;
}

/** keys that would otherwise scroll or trigger browser UI during a race */
const SWALLOW = new Set(['Space', 'F3']);

function map(bindings: Record<string, RaceAction>, player: PlayerId): void {
  for (const code of Object.keys(bindings)) {
    KEY_MAP.set(code, { action: bindings[code], player });
  }
}

const KEY_MAP = new Map<string, Binding>();

// player one: also owns the menus
map(
  {
    Space: 'react',
    KeyA: 'left',
    ArrowLeft: 'left',
    KeyD: 'right',
    ArrowRight: 'right',
    KeyS: 'dip',
    ArrowDown: 'dip',
    Enter: 'confirm',
    Escape: 'back',
    KeyP: 'pause',
    F3: 'debug',
  },
  0,
);

// player two: J/L/K, reacting on right shift
map({ ShiftRight: 'react', Numpad0: 'react', KeyJ: 'left', KeyL: 'right', KeyK: 'dip' }, 1);

const PAD_BUTTONS: { index: number; action: RaceAction }[] = [
  { index: 0, action: 'react' }, // south / A
  { index: 2, action: 'left' }, // west / X
  { index: 3, action: 'right' }, // east / Y
  { index: 1, action: 'dip' }, // north / B
  { index: 12, action: 'left' }, // dpad up
  { index: 13, action: 'dip' }, // dpad down
  { index: 14, action: 'left' }, // dpad left
  { index: 15, action: 'right' }, // dpad right
  { index: 9, action: 'pause' }, // start
  { index: 8, action: 'back' }, // select
];

export class InputManager {
  /** drained by the race each frame */
  readonly queue: InputEvent[] = [];
  private padPrev: boolean[][] = [];
  /** pad index in the order pads were first seen, so P1 is always the first */
  private padOrder: number[] = [];
  private held = new Set<string>();
  private attached = false;

  private onKeyDown = (e: KeyboardEvent): void => {
    const b = KEY_MAP.get(e.code);
    if (!b) return;
    if (SWALLOW.has(e.code) || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    this.push(b.action, 'key', undefined, b.player);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const b = KEY_MAP.get(e.code);
    if (b) this.held.delete(key(b.action, b.player));
  };

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  /** mobile / on-screen button press */
  touch(action: RaceAction, player: PlayerId = 0, at = performance.now() / 1000): void {
    this.push(action, 'touch', at, player);
  }

  isHeld(action: RaceAction, player: PlayerId = 0): boolean {
    return this.held.has(key(action, player));
  }

  /** call once per frame, before reading the queue */
  pollGamepads(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad) {
        this.padOrder = this.padOrder.filter((p) => p !== i);
        continue;
      }
      if (!this.padOrder.includes(i)) this.padOrder.push(i);
      const player: PlayerId = this.padOrder.indexOf(i) === 0 ? 0 : 1;
      const prev = this.padPrev[i] ?? [];
      for (const b of PAD_BUTTONS) {
        const down = pad.buttons[b.index]?.pressed ?? false;
        if (down && !prev[b.index]) this.push(b.action, 'pad', undefined, player);
        if (!down && prev[b.index]) this.held.delete(key(b.action, player));
        prev[b.index] = down;
      }
      this.padPrev[i] = prev;
    }
  }

  drain(): InputEvent[] {
    const out = this.queue.slice();
    this.queue.length = 0;
    return out;
  }

  private push(
    action: RaceAction,
    source: InputEvent['source'],
    at = performance.now() / 1000,
    player: PlayerId = 0,
  ): void {
    this.held.add(key(action, player));
    this.queue.push({ action, at, source, player });
    // never let a stuck key build a backlog
    if (this.queue.length > 32) this.queue.splice(0, this.queue.length - 32);
  }
}

function key(action: RaceAction, player: PlayerId): string {
  return `${player}:${action}`;
}
