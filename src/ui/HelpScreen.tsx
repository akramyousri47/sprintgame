/** How to play: the start, the rhythm loop, the dive and the rules. */

import { useGame } from '../state/store';
import { Button, Panel } from './parts';
import { FINISH, START, TRACK, WIND } from '../game/config';

export function HelpScreen() {
  const setScreen = useGame((s) => s.setScreen);
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center gap-4 overflow-y-auto p-6">
      <h2 className="display text-3xl">How to play</h2>

      <div className="grid w-full max-w-4xl gap-4 lg:grid-cols-2">
        <Panel>
          <h3 className="display text-lg text-cyan-300">The start</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-white/75">
            <li>Wait in your blocks through the intro.</li>
            <li>
              Hold still through <strong>SET</strong> — the hold is a random{' '}
              {(START.holdMin * 1000).toFixed(0)}–{(START.holdMax * 1000).toFixed(0)} ms.
            </li>
            <li>
              Press <Kbd>Space</Kbd> on the gun. Too early and it is a false start; inside{' '}
              {(START.falseStartThreshold * 1000).toFixed(0)} ms and you are disqualified.
            </li>
            <li>Your block push and your athlete's strength decide the first two metres.</li>
          </ol>
        </Panel>

        <Panel>
          <h3 className="display text-lg text-cyan-300">The rhythm loop</h3>
          <p className="mt-2 text-sm text-white/75">
            Sprinting is foot strikes, not a button mash. A marker sweeps toward the centre of the rhythm
            bar on every foot strike — press the matching key as it lands.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <Kbd>A</Kbd> / <Kbd>←</Kbd> <span className="text-white/60">left foot</span>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <Kbd>D</Kbd> / <Kbd>→</Kbd> <span className="text-white/60">right foot</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-white/45">
            Clean strikes raise your rhythm percentage, which the gait model converts into speed. Mashing
            costs you. A gamepad works too: west and east for the feet, south to react.
          </p>
        </Panel>

        <Panel>
          <h3 className="display text-lg text-cyan-300">The finish</h3>
          <p className="mt-2 text-sm text-white/75">
            The last {FINISH.dipWindow} m is the dive window. Press <Kbd>S</Kbd> / <Kbd>↓</Kbd> inside it and
            you lunge for the line; the closer you are, the more it is worth, up to{' '}
            {(FINISH.dipBonusTime * 1000).toFixed(0)} ms. Dive too early and you plant your hands in the sand.
          </p>
          <p className="mt-2 text-[11px] text-white/45">
            The finish is timed in whole metres: the line is at {TRACK.raceDistance} m.
          </p>
        </Panel>

        <Panel>
          <h3 className="display text-lg text-cyan-300">Conditions</h3>
          <p className="mt-2 text-sm text-white/75">
            A headwind up to {WIND.legalLimit.toFixed(1)} m/s is legal and shaves your top speed. A tailwind
            gives a little back. You choose the wind before the race.
          </p>
          <h3 className="display mt-4 text-lg text-cyan-300">Modes</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-white/70">
            <li>
              <strong>Quick Race</strong> — the full {TRACK.lanes}-lane field.
            </li>
            <li>
              <strong>Career</strong> — heat, semi-final, final, a medal if you keep qualifying.
            </li>
            <li>
              <strong>Time Trial</strong> — you alone, racing your own best.
            </li>
            <li>
              <strong>2 Player</strong> — split keyboard: P1 uses <Kbd>Space</Kbd>/<Kbd>A</Kbd>/<Kbd>D</Kbd>/
              <Kbd>S</Kbd>, P2 uses right <Kbd>Shift</Kbd>/<Kbd>J</Kbd>/<Kbd>L</Kbd>/<Kbd>K</Kbd>.
            </li>
          </ul>
        </Panel>
      </div>

      <Button tone="primary" onClick={() => setScreen('title')}>
        Got it
      </Button>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
      {children}
    </kbd>
  );
}
