/** Career: heats, semi-final and final, with the medal tally. */

import { useGame } from '../state/store';
import { Button, Panel, fmtTime } from './parts';
import type { CareerStage } from '../state/store';

const STAGE_LABEL: Record<CareerStage, string> = {
  heat: 'Heat',
  semi: 'Semi-final',
  final: 'Final',
};

const STAGE_NOTE: Record<CareerStage, string> = {
  heat: 'Top two advance',
  semi: 'Top two advance',
  final: 'A top-three finish is a medal',
};

export function CareerScreen() {
  const career = useGame((s) => s.career);
  const setScreen = useGame((s) => s.setScreen);
  const patch = useGame((s) => s.patch);
  const resetCareer = useGame((s) => s.resetCareer);

  const done = career.medal !== 'none' || career.history.length >= 3;

  const start = () => {
    patch({ mode: 'career', results: null, lastTime: null, isPb: false, distance: 100 });
    setScreen('athlete');
  };

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center gap-4 p-6">
      <h2 className="display text-3xl">Career</h2>

      <div className="flex items-center gap-2">
        {(['heat', 'semi', 'final'] as CareerStage[]).map((s, i) => {
          const order = ['heat', 'semi', 'final'];
          const state = order.indexOf(s) < order.indexOf(career.stage) ? 'done' : s === career.stage ? 'now' : 'todo';
          return (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-8 bg-white/20" />}
              <div
                className={`rounded-lg border px-3 py-1.5 text-center ${
                  state === 'done'
                    ? 'border-emerald-400/50 bg-emerald-500/15'
                    : state === 'now'
                      ? 'border-cyan-400 bg-cyan-500/20'
                      : 'border-white/10 bg-ink/50 opacity-50'
                }`}
              >
                <p className="text-xs font-semibold">{STAGE_LABEL[s]}</p>
                <p className="text-[10px] text-white/50">{state === 'done' ? 'cleared' : state === 'now' ? 'next' : 'locked'}</p>
              </div>
            </div>
          );
        })}
      </div>

      <Panel className="w-full max-w-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="display text-xl">
              Round {career.round} · {STAGE_LABEL[career.stage]}
            </p>
            <p className="text-[11px] text-white/50">{STAGE_NOTE[career.stage]}</p>
          </div>
          {career.medal !== 'none' && <Medal kind={career.medal} />}
        </div>

        {career.history.length > 0 && (
          <table className="mt-4 w-full text-xs">
            <tbody>
              {career.history.map((h, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="py-1.5 text-white/60">{STAGE_LABEL[h.stage]}</td>
                  <td className="num py-1.5">P{h.place || '–'}</td>
                  <td className="num py-1.5 text-right text-white/50">{fmtTime(h.time)} s</td>
                  <td className="py-1.5 text-right">
                    {h.place <= 3 ? <span className="text-[10px] text-emerald-300">advanced</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {done && (
        <Panel className="w-full max-w-lg text-center">
          <p className="display text-2xl">
            {career.medal === 'none' ? 'CAREER OVER' : `${career.medal.toUpperCase()} MEDAL`}
          </p>
          <p className="mt-1 text-[11px] text-white/50">
            {career.history.length
              ? `Best finish: P${Math.min(...career.history.map((h) => h.place).filter((p) => p > 0))}`
              : ''}
          </p>
        </Panel>
      )}

      <div className="flex gap-3 pb-6">
        <Button onClick={() => setScreen('title')}>Back</Button>
        {done ? (
          <Button
            tone="primary"
            onClick={() => {
              resetCareer();
              start();
            }}
          >
            New career
          </Button>
        ) : (
          <Button tone="primary" onClick={start}>
            {career.history.length > 0 ? 'Race next round' : 'Start career'}
          </Button>
        )}
      </div>
    </div>
  );
}

function Medal({ kind }: { kind: 'gold' | 'silver' | 'bronze' }) {
  const tones = {
    gold: 'from-yellow-300 to-amber-500',
    silver: 'from-slate-200 to-slate-400',
    bronze: 'from-orange-300 to-amber-700',
  } as const;
  return (
    <div
      className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br ${tones[kind]} text-[10px] font-bold uppercase text-black/80`}
    >
      {kind}
    </div>
  );
}
