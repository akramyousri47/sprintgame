/** Shared bits for the overlay screens: the panel look, buttons and flags. */

import type { ReactNode } from 'react';
import { audio } from '../audio/audio';
import { flagDataUrl } from '../data/flags';
import type { Nation } from '../data/athletes';

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`pointer-events-auto rounded-2xl border border-white/10 bg-ink/85 p-6 shadow-2xl backdrop-blur-md ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  tone = 'default',
  disabled = false,
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  className?: string;
}) {
  const tones: Record<string, string> = {
    default: 'border-white/20 bg-white/5 hover:bg-white/15',
    primary: 'border-cyan-400/60 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/35',
    danger: 'border-red-400/50 bg-red-500/20 text-red-100 hover:bg-red-500/35',
    ghost: 'border-transparent bg-transparent text-white/70 hover:bg-white/10',
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        audio.click();
        onClick();
      }}
      className={`pointer-events-auto rounded-lg border px-4 py-2 text-sm font-semibold tracking-wide transition disabled:cursor-not-allowed disabled:opacity-35 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Flag({ nation, className = 'h-8 w-12' }: { nation: Nation; className?: string }) {
  return (
    <img
      src={flagDataUrl(nation)}
      alt={nation.name}
      className={`${className} rounded-sm object-cover ring-1 ring-white/20`}
    />
  );
}

/** 12.34 */
export function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return '—.—';
  return t.toFixed(2);
}

export function fmtClock(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '0.00';
  return t.toFixed(2);
}

/** a 0..1 bar */
export function Bar({ value, tone = 'cyan' }: { value: number; tone?: 'cyan' | 'red' | 'green' }) {
  const tones = {
    cyan: 'bg-cyan-400',
    red: 'bg-red-500',
    green: 'bg-emerald-400',
  } as const;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full transition-[width] duration-75 ${tones[tone]}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}
