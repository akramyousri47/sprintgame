/** Title / main menu. */

import { audio } from '../audio/audio';
import { useGame } from '../state/store';
import { Button, Panel } from './parts';
import { ATHLETES } from '../data/athletes';

export function TitleScreen() {
  const setScreen = useGame((s) => s.setScreen);
  const patch = useGame((s) => s.patch);
  const mode = useGame((s) => s.mode);
  const bests = useGame((s) => s.bests);
  const career = useGame((s) => s.career);

  const start = (m: typeof mode) => {
    patch({ mode: m });
    audio.start().then(() => audio.cheer(0.5));
    setScreen('athlete');
  };

  const best = bests[useGame((s) => s.playerAthleteId)];
  const pb = best ? `${best.toFixed(2)} s` : 'no time set';

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <p className="display text-xs uppercase tracking-[0.6em] text-cyan-300/80">Global</p>
        <h1 className="display text-6xl leading-none text-white drop-shadow-[0_6px_30px_rgba(34,211,238,0.25)] sm:text-8xl">
          SPRINT GAMES
        </h1>
        <p className="mt-3 text-sm text-white/60">
          {ATHLETES.length} athletes · 8 lanes · 100 m · drive the rhythm
        </p>
      </div>

      <Panel className="flex w-full max-w-md flex-col gap-3">
        <Button tone="primary" className="py-3 text-base" onClick={() => start('quick')}>
          Quick Race
        </Button>
        <div className="grid grid-cols-2 gap-3">
          <Button onClick={() => setScreen('career')}>Career</Button>
          <Button onClick={() => start('timeTrial')}>Time Trial</Button>
          <Button onClick={() => start('versus')}>2 Player</Button>
          <Button onClick={() => setScreen('help')}>How to Play</Button>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-white/50">
          <button
            type="button"
            className="pointer-events-auto underline-offset-2 hover:underline"
            onClick={() => {
              audio.click();
              setScreen('settings');
            }}
          >
            Settings
          </button>
          <span>
            PB {pb} · Career {career.round > 1 ? `round ${career.round}` : 'not started'}
          </span>
        </div>
      </Panel>

      <p className="max-w-md text-center text-[11px] leading-relaxed text-white/35">
        An original game. Every nation, athlete and flag in this project is fictional.
        <br />
        Press <Kbd>Enter</Kbd> for a quick race · <Kbd>F3</Kbd> for the debug overlay
      </p>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/70">
      {children}
    </kbd>
  );
}
