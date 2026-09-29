/**
 * The in-race HUD.
 *
 * Everything here reads the throttled snapshot from the store — this component
 * never reads the race directly, so React can re-render 30 times a second
 * without touching the simulation.
 */

import { useEffect, useRef, useState } from 'react';
import { gameApp } from '../game/app';
import { useGame } from '../state/store';
import type { RaceSnapshot } from '../game/race';
import type { TapGrade } from '../biomechanics/gait';
import { Button, fmtClock } from './parts';

export function Hud() {
  const live = useGame((s) => s.live);
  const paused = useGame((s) => s.paused);
  const setScreen = useGame((s) => s.setScreen);
  const [toast, setToast] = useState<string | null>(null);
  const lastGrade = useRef<TapGrade | null>(null);
  const flash = useRef<HTMLDivElement | null>(null);

  // show the engine's callouts ("SET", "Go", "Dive", "False start") briefly
  useEffect(() => {
    if (!live) return;
    if (live.raceTime - live.messageAt > 1.4 || live.messageAt < 0) {
      setToast(null);
      return;
    }
    setToast(live.message);
  }, [live?.message, live?.messageAt, live]);

  // a flash on every well-timed strike
  useEffect(() => {
    const g = live?.player.grade;
    if (!g || g === 'mash' || g === 'early' || g === lastGrade.current) return;
    if (g !== 'perfect' && g !== 'good') return;
    lastGrade.current = g;
    const el = flash.current;
    if (!el) return;
    el.classList.remove('stride-flash');
    void el.offsetWidth;
    el.classList.add('stride-flash');
  }, [live?.player.grade, live]);

  if (!live) return null;

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <TopBar live={live} />
      {live.p2 && <P2Bar live={live} />}
      <RhythmMeter live={live} />
      <DipPrompt live={live} />
      <Messages live={live} toast={toast} />
      <div ref={flash} className="absolute inset-x-0 top-1/2 h-px opacity-0" />
      {paused && <PauseOverlay onQuit={() => setScreen('title')} />}
      <TouchBar />
      <DebugOverlay />
    </div>
  );
}

function TopBar({ live }: { live: RaceSnapshot }) {
  const p = live.player;
  const wind = live.wind;
  return (
    <div className="absolute inset-x-0 top-0 flex items-start justify-between p-4">
      <div className="num rounded-lg bg-ink/70 px-3 py-2 text-sm backdrop-blur">
        <span className="text-2xl text-cyan-300">{fmtClock(live.clock)}</span>
        <span className="ml-2 text-white/50">{p.distance.toFixed(1)} m</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="num rounded-lg bg-ink/70 px-3 py-1 text-xs text-white/70 backdrop-blur">
          {wind > 0 ? `HEAD ${wind.toFixed(1)}` : wind < 0 ? `TAIL ${(-wind).toFixed(1)}` : 'CALM'} m/s
        </span>
        <span className="num rounded-lg bg-ink/70 px-3 py-1 text-xs text-white/70 backdrop-blur">
          {p.speed.toFixed(1)} m/s
        </span>
      </div>
      <div className="num rounded-lg bg-ink/70 px-3 py-2 text-sm backdrop-blur">
        <span className="text-white/50">P</span>
        <span className="text-2xl">{p.rank > 0 ? p.rank : '–'}</span>
        <span className="text-white/50">/{8}</span>
      </div>
    </div>
  );
}

function P2Bar({ live }: { live: RaceSnapshot }) {
  const p = live.p2;
  if (!p) return null;
  return (
    <div className="absolute inset-x-0 top-20 flex justify-center">
      <div className="num rounded-lg border border-amber-400/40 bg-ink/70 px-3 py-1 text-xs text-amber-200 backdrop-blur">
        P2 {p.distance.toFixed(1)} m · {p.speed.toFixed(1)} m/s · P{p.rank || '–'} · {fmtClock(p.toStrike > 0 ? p.toStrike : 0)}
      </div>
    </div>
  );
}

/**
 * The rhythm bar: a marker sweeps to the middle on every foot strike, and the
 * player presses the matching key. Tighter timing means a higher quality,
 * which the gait model turns into more speed.
 */
function RhythmMeter({ live }: { live: RaceSnapshot }) {
  const p = live.player;
  if (!p.started) return null;
  const window = 0.28;
  const t = p.toStrike;
  const hot = t < 0.09;
  const grade = p.grade;
  return (
    <div className="absolute bottom-28 left-1/2 w-64 -translate-x-1/2">
      <div className="mb-1 flex justify-between text-[10px] uppercase tracking-widest text-white/40">
        <span className={p.quality > 0.8 ? 'text-emerald-300' : p.quality > 0.55 ? 'text-amber-300' : 'text-red-300'}>
          rhythm {(p.quality * 100).toFixed(0)}%
        </span>
        <span className={hot ? 'text-cyan-300' : 'text-white/40'}>{gradeLabel(grade)}</span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full border border-white/15 bg-ink/70 backdrop-blur">
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/60" />
        <div
          className={`absolute inset-y-0 w-1/2 transition-[background] ${
            p.quality > 0.8 ? 'bg-emerald-400' : p.quality > 0.55 ? 'bg-amber-400' : 'bg-red-400'
          } opacity-80`}
          style={{ left: `calc(${Math.max(0, 1 - t / window) * 100}% - 4px)` }}
        />
      </div>
      <div className="mt-1 text-center text-[10px] text-white/35">
        {p.dq ? 'disqualified' : `${(p.toStrike * 1000).toFixed(0)} ms to strike`}
      </div>
    </div>
  );
}

function gradeLabel(g: TapGrade | null): string {
  switch (g) {
    case 'perfect':
      return 'perfect';
    case 'good':
      return 'good';
    case 'early':
      return 'off timing';
    case 'mash':
      return 'too fast';
    default:
      return '';
  }
}

/** the last-15 m prompt: a dive here is worth real time */
function DipPrompt({ live }: { live: RaceSnapshot }) {
  if (!live.dipWindow) return null;
  return (
    <div className="absolute bottom-52 left-1/2 -translate-x-1/2 animate-pulse text-center">
      <div className="display text-2xl text-cyan-300 drop-shadow-[0_0_18px_rgba(34,211,238,0.6)]">DIVE!</div>
      <div className="num text-[11px] text-white/60">press S / ↓ now</div>
    </div>
  );
}

function Messages({ live, toast }: { live: RaceSnapshot; toast: string | null }) {
  const big =
    live.phase === 'intro'
      ? 'GET READY'
      : live.phase === 'set'
        ? 'SET'
        : live.phase === 'hold'
          ? `${live.clock.toFixed(1)}`
          : live.phase === 'running' && !live.player.started
            ? 'GO'
            : null;
  return (
    <>
      {big && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div key={big} className={big === 'SET' ? 'gun-shake display text-9xl text-red-500' : 'display text-8xl text-white/90'}>
            {big}
          </div>
        </div>
      )}
      {toast && (
        <div className="absolute inset-x-0 top-1/3 text-center">
          <span className="display rounded bg-ink/70 px-4 py-2 text-3xl text-cyan-300 backdrop-blur">{toast}</span>
        </div>
      )}
      {live.player.dq && (
        <div className="absolute inset-x-0 top-1/4 text-center">
          <span className="display rounded bg-red-900/70 px-4 py-2 text-2xl text-red-200 backdrop-blur">
            FALSE START
          </span>
          <p className="mt-2 text-xs text-red-200/80">{live.player.dqReason}</p>
        </div>
      )}
    </>
  );
}

function PauseOverlay({ onQuit }: { onQuit: () => void }) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-ink/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4">
        <h2 className="display text-4xl">PAUSED</h2>
        <div className="flex gap-3">
          <Button tone="primary" onClick={() => gameApp().setPaused(false)}>
            Resume
          </Button>
          <Button tone="danger" onClick={onQuit}>
            Quit to menu
          </Button>
        </div>
      </div>
    </div>
  );
}

/** on-screen controls for touch devices; hidden when there is no pointer */
function TouchBar() {
  const [touch] = useState(() => typeof window !== 'undefined' && 'ontouchstart' in window);
  if (!touch) return null;
  const press = (action: 'left' | 'right' | 'react' | 'dip') => () => {
    const app = gameApp();
    app.setPaused(false);
    app.pushTouch(action);
  };
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-4 flex items-end justify-between px-6">
      <div className="flex gap-3">
        <TouchButton onPress={press('left')} label="LEFT · L" tone="bg-cyan-500/30 border-cyan-300/50" />
        <TouchButton onPress={press('right')} label="RIGHT · R" tone="bg-cyan-500/30 border-cyan-300/50" />
      </div>
      <div className="flex gap-3">
        <TouchButton onPress={press('react')} label="REACT" tone="bg-white/15 border-white/40" small />
        <TouchButton onPress={press('dip')} label="DIVE" tone="bg-red-500/30 border-red-300/50" small />
      </div>
    </div>
  );
}

function TouchButton({
  onPress,
  label,
  tone,
  small = false,
}: {
  onPress: () => void;
  label: string;
  tone: string;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      className={`rounded-full border ${tone} ${small ? 'h-16 w-16 text-[10px]' : 'h-20 w-20 text-xs'} flex items-center justify-center font-semibold active:scale-95`}
    >
      {label}
    </button>
  );
}

/** the F3 overlay: frame time, draw calls and the resolution scale */
function DebugOverlay() {
  const show = useGame((s) => s.settings.showDebug);
  const perf = useGame((s) => s.perf);
  if (!show) return null;
  return (
    <div className="num absolute bottom-4 left-4 rounded bg-black/70 p-2 text-[10px] leading-relaxed text-lime-300">
      fps {perf.fps.toFixed(0)} · draw {perf.drawMs.toFixed(1)} ms
      <br />
      calls {perf.calls} · tris {(perf.triangles / 1000).toFixed(0)}k
      <br />
      scale {perf.scale.toFixed(2)}x
    </div>
  );
}
