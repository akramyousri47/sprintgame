/** Athlete select: pick who you are, and see the numbers that drive the model. */

import { useState } from 'react';
import { useGame } from '../state/store';
import { Button, Flag, Panel } from './parts';
import { ATHLETES } from '../data/athletes';

const STAT_LABELS: Record<string, string> = {
  start: 'Start',
  acceleration: 'Accel',
  topSpeed: 'Top speed',
  endurance: 'Endurance',
  technique: 'Technique',
};

export function AthleteScreen() {
  const playerAthleteId = useGame((s) => s.playerAthleteId);
  const patch = useGame((s) => s.patch);
  const setScreen = useGame((s) => s.setScreen);
  const bests = useGame((s) => s.bests);
  const mode = useGame((s) => s.mode);
  const [open, setOpen] = useState<number | null>(playerAthleteId);

  const athlete = ATHLETES[open ?? playerAthleteId];

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center gap-4 overflow-y-auto p-6">
      <h2 className="display text-3xl tracking-wide">Select your athlete</h2>

      <div className="grid w-full max-w-5xl grid-cols-2 gap-3 sm:grid-cols-4">
        {ATHLETES.map((a) => {
          const chosen = a.id === playerAthleteId;
          const pb = bests[a.id];
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                patch({ playerAthleteId: a.id });
                setOpen(a.id);
              }}
              className={`pointer-events-auto flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition ${
                chosen ? 'border-cyan-400 bg-cyan-500/15' : 'border-white/10 bg-ink/70 hover:bg-white/10'
              }`}
            >
              <div className="flex w-full items-center gap-2">
                <Flag nation={a.nation} className="h-6 w-10" />
                <span className="num text-xs text-white/50">#{a.look.bib}</span>
              </div>
              <span className="text-sm font-semibold">{a.name}</span>
              <span className="text-[11px] text-white/50">
                {a.nation.name} · {a.height.toFixed(2)} m
              </span>
              <span className="num text-[11px] text-cyan-300/80">
                {a.stats.topSpeed.toFixed(1)} m/s · {(a.params.stepLengthMax).toFixed(2)} m step
              </span>
              <span className="num text-[10px] text-white/40">
                {pb ? `PB ${pb.toFixed(2)} s` : 'no PB'}
              </span>
            </button>
          );
        })}
      </div>

      {athlete && (
        <Panel className="w-full max-w-2xl">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="display text-xl">{athlete.name}</h3>
              <p className="text-xs text-white/50">
                {athlete.nation.name} · {athlete.height.toFixed(2)} m · limb ratio{' '}
                {athlete.shape.limbScale.toFixed(2)}
              </p>
            </div>
            <Flag nation={athlete.nation} className="h-10 w-16" />
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
            {(['start', 'acceleration', 'topSpeed', 'endurance', 'technique'] as const).map((k) => {
              const raw = athlete.stats[k];
              const v = k === 'topSpeed' ? (raw - 10.1) / (12.1 - 10.1) : raw;
              return (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[11px] text-white/55">{STAT_LABELS[k]}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-cyan-400" style={{ width: `${v * 100}%` }} />
                  </div>
                  <span className="num w-10 text-right text-[10px] text-white/45">
                    {k === 'topSpeed' ? raw.toFixed(1) : raw.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

          <div className="flex gap-3 pb-6">
        <Button onClick={() => setScreen('title')}>Back</Button>
        <Button tone="primary" onClick={() => setScreen('lane')}>
          {mode === 'versus' ? 'Next: player 2 lane' : 'Next: choose your lane'}
        </Button>
      </div>
    </div>
  );
}
