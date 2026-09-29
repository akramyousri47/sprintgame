/** Post-race results: the finish order, your splits, and the replay. */

import { useEffect, useState } from 'react';
import { gameApp } from '../game/app';
import { useGame } from '../state/store';
import { Button, Panel, fmtTime } from './parts';

export function ResultsScreen() {
  const results = useGame((s) => s.results);
  const lastTime = useGame((s) => s.lastTime);
  const isPb = useGame((s) => s.isPb);
  const mode = useGame((s) => s.mode);
  const career = useGame((s) => s.career);
  const playerLane = useGame((s) => s.playerLane);
  const player2Lane = useGame((s) => s.player2Lane);
  const patch = useGame((s) => s.patch);
  const setScreen = useGame((s) => s.setScreen);
  const replaying = useGame((s) => s.replaying);
  const advanceCareer = useGame((s) => s.advanceCareer);
  const [pickedLane, setPickedLane] = useState(0);

  // versus marks both humans, so the summary has to pick the right one
  const me = results?.find((r) => r.player && r.lane === playerLane) ?? results?.find((r) => r.player) ?? null;
  const me2 = results?.find((r) => r.player && r.lane === player2Lane) ?? null;
  const valid = results?.filter((r) => r.valid) ?? [];
  const place = valid.findIndex((r) => r.player && r.lane === playerLane) + 1;
  const place2 = valid.findIndex((r) => r.player && r.lane === player2Lane) + 1;

  // slow-motion replay of the final stretch, on request. the cleanup is tied to
  // unmount only: keying it on `replaying` would tear the replay down the
  // instant it started.
  useEffect(() => () => gameApp().stopReplay(), []);

  if (!results) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Panel>
          <p className="text-sm text-white/70">Reading the photo finish…</p>
        </Panel>
      </div>
    );
  }

  const next = () => {
    gameApp().stopReplay();
    if (mode === 'career') {
      setScreen('career');
      return;
    }
    setScreen('title');
  };

  // a career round counts once the athlete's finish is known, not every time
  // this screen renders
  const round = career.history.length;
  useEffect(() => {
    if (mode !== 'career' || !results) return;
    if (career.history.length > round) return;
    advanceCareer(place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, round]);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center gap-4 overflow-y-auto p-6">
      <h2 className="display text-4xl">
        {me?.valid === false ? 'DISQUALIFIED' : place === 1 ? 'WINNER' : `P${place || '–'}`}
        {me2 && <span className="text-white/50"> vs P{place2 || '–'}</span>}
      </h2>
      <div className="num text-4xl text-cyan-300">{fmtTime(lastTime ?? NaN)} s</div>
      <div className="flex flex-wrap justify-center gap-2">
        {isPb && <Badge tone="bg-emerald-400 text-black">PERSONAL BEST</Badge>}
        {me && !me.valid && <Badge tone="bg-red-500 text-white">{me.dqReason}</Badge>}
        {mode === 'career' && <Badge tone="bg-white/15 text-white">{career.stage} · round {career.round}</Badge>}
      </div>

      {replaying && <Badge tone="bg-cyan-400 text-black">REPLAY · quarter speed</Badge>}

      <Panel className="w-full max-w-3xl !p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-widest text-white/40">
              <th className="px-4 py-2">#</th>
              <th className="px-2 py-2">Athlete</th>
              <th className="px-2 py-2">Nation</th>
              <th className="px-2 py-2 text-right">Time</th>
              <th className="px-2 py-2 text-right">Reaction</th>
              <th className="px-2 py-2 text-right">Top</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.lane}
                className={`border-b border-white/5 ${r.player ? 'bg-cyan-500/10' : ''} ${!r.valid ? 'opacity-45' : ''}`}
              >
                <td className="num px-4 py-1.5 text-white/60">{r.valid ? r.rank : '—'}</td>
                <td className="px-2 py-1.5 font-semibold">
                  {r.name}
                  {r.player && (
                    <span className="ml-2 text-[10px] text-cyan-300">
                      {r.lane === playerLane ? 'YOU' : r.lane === player2Lane ? 'P2' : 'YOU'}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-white/60">{r.nation}</td>
                <td className="num px-2 py-1.5 text-right">{r.valid ? fmtTime(r.time) : 'DNF'}</td>
                <td className="num px-2 py-1.5 text-right text-white/50">
                  {r.valid ? `${(r.reaction * 1000).toFixed(0)}` : '—'}
                </td>
                <td className="num px-2 py-1.5 text-right text-white/50">{r.valid ? r.topSpeed.toFixed(1) : '—'}</td>
                <td className="px-4 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setPickedLane(r.lane);
                      gameApp().startReplay(r.lane);
                    }}
                    className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-white/60 hover:bg-white/10"
                  >
                    replay
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {me?.valid && (
        <Panel className="w-full max-w-3xl">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
            <Stat label="Wind" value={`${(me.wind * 1).toFixed(1)} m/s`} />
            <Stat label="Dive bonus" value={`${me.dip.toFixed(3)} s`} />
            <Stat label="Top speed" value={`${me.topSpeed.toFixed(1)} m/s`} />
            <Stat label="Step length" value={`${me.stepLength.toFixed(2)} m`} />
          </div>
        </Panel>
      )}

      <div className="flex gap-3 pb-6">
        <Button
          onClick={() => {
            if (replaying) {
              gameApp().stopReplay();
            } else {
              const me = results.find((r) => r.player);
              const lane = me ? me.lane : pickedLane;
              setPickedLane(lane);
              gameApp().startReplay(lane);
            }
          }}
        >
          {replaying ? 'Stop replay' : 'Watch replay'}
        </Button>
        <Button tone="primary" onClick={next}>
          {mode === 'career' ? 'Career' : 'Main menu'}
        </Button>
        <Button
          onClick={() => {
            gameApp().stopReplay();
            patch({ results: null, lastTime: null, isPb: false });
            setScreen('lane');
          }}
        >
          Race again
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/35">{label}</p>
      <p className="num text-sm text-white/80">{value}</p>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold tracking-wider ${tone}`}>{children}</span>;
}
