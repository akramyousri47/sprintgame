/**
 * Lane draw: pick your lane, and in two player mode pick the second lane too.
 * The camera is already behind the blocks at this point, so this doubles as the
 * "here is your view" screen.
 */

import { audio } from '../audio/audio';
import { gameApp } from '../game/app';
import { useGame } from '../state/store';
import { Button, Panel } from './parts';
import { TRACK, WIND } from '../game/config';
import { ATHLETES } from '../data/athletes';

export function LaneScreen() {
  const mode = useGame((s) => s.mode);
  const playerLane = useGame((s) => s.playerLane);
  const player2Lane = useGame((s) => s.player2Lane);
  const patch = useGame((s) => s.patch);
  const setScreen = useGame((s) => s.setScreen);
  const two = mode === 'versus';

  const lanes = Array.from({ length: TRACK.lanes }, (_, i) => i);
  const p2Athlete = useGame((s) => s.player2AthleteId);
  const p1Athlete = useGame((s) => s.playerAthleteId);

  const go = () => {
    // last guard before the race exists: the two humans can never share a lane
    const lane2 = two && player2Lane === playerLane ? (playerLane + 1) % TRACK.lanes : player2Lane;
    if (two && lane2 !== player2Lane) patch({ player2Lane: lane2 });
    audio.start().then(() => audio.cheer(0.4));
    gameApp().startRace();
  };

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center gap-5 p-6">
      <h2 className="display text-3xl tracking-wide">{two ? 'Two player: choose lanes' : 'Choose your lane'}</h2>
      <p className="text-xs text-white/50">
        lane 1 is the rail · lane {TRACK.lanes} is the rail · centre is {Math.ceil(TRACK.lanes / 2)}
      </p>

      <div className="flex w-full max-w-3xl flex-col gap-1.5">
        {lanes.map((lane) => {
          const p1 = lane === playerLane;
          const p2 = lane === player2Lane;
          return (
            <button
              key={lane}
              type="button"
              onClick={() => {
                audio.click();
                if (two) {
                  // clicking P2's lane swaps the two, clicking a free lane
                  // hands it to P1 and pushes P2 off it, so the pair can never
                  // collapse onto one lane
                  if (p2) patch({ playerLane: lane, player2Lane: playerLane });
                  else patch({ playerLane: lane, player2Lane: p1 ? player2Lane : lane });
                } else {
                  patch({ playerLane: lane });
                }
              }}
              className={`pointer-events-auto flex items-center justify-between rounded-lg border px-4 py-2.5 transition ${
                p1 || p2 ? 'border-cyan-400 bg-cyan-500/20' : 'border-white/10 bg-ink/60 hover:bg-white/10'
              }`}
            >
              <span className="num text-xs text-white/50">lane {lane + 1}</span>
              <span className="flex gap-2">
                {p1 && <Tag tone="border-cyan-300 text-cyan-200">P1 · {ATHLETES[p1Athlete].name}</Tag>}
                {p2 && <Tag tone="border-amber-300 text-amber-200">P2 · {ATHLETES[p2Athlete].name}</Tag>}
              </span>
              <span className="num text-[10px] text-white/30">
                {lane === 0 || lane === TRACK.lanes - 1
                  ? 'kerb'
                  : `${(((lane + 0.5) / TRACK.lanes - 0.5) * TRACK.laneWidth * 100).toFixed(0)} cm`}
              </span>
            </button>
          );
        })}
      </div>

      {two && (
        <Panel className="w-full max-w-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Player 2 athlete</p>
              <p className="text-[11px] text-white/50">
                {ATHLETES[p2Athlete].name} · {ATHLETES[p2Athlete].nation.name}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              {ATHLETES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    audio.click();
                    patch({ player2AthleteId: a.id });
                  }}
                  className={`num rounded px-2 py-1 text-[10px] transition ${
                    a.id === p2Athlete ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'
                  }`}
                >
                  {a.look.bib}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-white/40">
            P1 uses Space, A/D and S. P2 uses right Shift, J/L and K, or a second gamepad.
          </p>
        </Panel>
      )}

      {!two && <WindPicker />}

      <div className="flex gap-3 pb-6">
        <Button onClick={() => setScreen('athlete')}>Back</Button>
        <Button tone="primary" className="px-8" onClick={go}>
          Take your marks
        </Button>
      </div>
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`num rounded border px-2 py-0.5 text-[10px] ${tone}`}>{children}</span>;
}

/** wind is legal up to +2.0 m/s on the nose; a tailwind is a small gift */
function WindPicker() {
  const wind = useGame((s) => s.wind);
  const patch = useGame((s) => s.patch);
  return (
    <Panel className="w-full max-w-md">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Conditions</span>
        <span className="num text-xs text-white/60">
          {wind > 0 ? `head ${wind.toFixed(1)}` : wind < 0 ? `tail ${(-wind).toFixed(1)}` : 'calm'} m/s
        </span>
      </div>
      <input
        type="range"
        min={-1}
        max={WIND.legalLimit}
        step={0.1}
        value={wind}
        onChange={(e) => patch({ wind: Number(e.target.value) })}
        className="mt-3 w-full accent-cyan-400"
      />
      <div className="mt-1 flex justify-between text-[10px] text-white/35">
        <span>tailwind</span>
        <span>calm</span>
        <span>headwind +{WIND.legalLimit.toFixed(1)}</span>
      </div>
    </Panel>
  );
}
