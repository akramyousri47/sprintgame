/** Settings: quality, audio levels, camera shake, and clearing saved data. */

import { gameApp } from '../game/app';
import { useGame } from '../state/store';
import { Button, Panel } from './parts';
import { QUALITY } from '../game/config';
import type { QualityName } from '../game/config';

const ORDER: QualityName[] = ['low', 'medium', 'high'];

export function SettingsScreen() {
  const settings = useGame((s) => s.settings);
  const patchSettings = useGame((s) => s.patchSettings);
  const setScreen = useGame((s) => s.setScreen);
  const resetCareer = useGame((s) => s.resetCareer);
  const bests = useGame((s) => s.bests);

  const quality = (q: QualityName) => {
    patchSettings({ quality: q });
    gameApp().setQuality(q);
  };

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center gap-4 p-6">
      <h2 className="display text-3xl">Settings</h2>
      <Panel className="w-full max-w-lg">
        <Row label="Graphics">
          <div className="flex gap-1">
            {ORDER.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => quality(q)}
                className={`rounded px-3 py-1 text-xs transition ${
                  settings.quality === q ? 'bg-cyan-400 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </Row>
        <p className="mb-3 -mt-1 pl-32 text-[10px] text-white/35">
          {QUALITY[settings.quality].shadows ? 'shadows on' : 'shadows off'} ·{' '}
          {QUALITY[settings.quality].crowdCount} crowd · resolution cap{' '}
          {QUALITY[settings.quality].pixelRatioCap.toFixed(2)}x
        </p>

        <Row label="Master volume">
          <Slider value={settings.volume} onChange={(v) => patchSettings({ volume: v })} />
        </Row>
        <Row label="Crowd">
          <Slider value={settings.crowdVolume} onChange={(v) => patchSettings({ crowdVolume: v })} />
        </Row>
        <Row label="Mute">
          <Toggle on={settings.muted} onClick={() => patchSettings({ muted: !settings.muted })} />
        </Row>
        <Row label="Camera shake">
          <Toggle on={settings.cameraShake} onClick={() => patchSettings({ cameraShake: !settings.cameraShake })} />
        </Row>
        <Row label="Debug overlay (F3)">
          <Toggle on={settings.showDebug} onClick={() => patchSettings({ showDebug: !settings.showDebug })} />
        </Row>
      </Panel>

      <Panel className="w-full max-w-lg">
        <Row label={`Personal bests (${Object.keys(bests).length})`}>
          <span className="text-[11px] text-white/40">stored locally</span>
        </Row>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              if (Object.keys(bests).length && !window.confirm('Clear all personal bests?')) return;
              localStorage.removeItem('gsg.bests.v1');
              useGame.setState({ bests: {} });
            }}
          >
            Clear bests
          </Button>
          <Button
            tone="danger"
            onClick={() => {
              if (window.confirm('Reset career progress?')) resetCareer();
            }}
          >
            Reset career
          </Button>
        </div>
      </Panel>

      <Button tone="primary" onClick={() => setScreen('title')}>
        Back
      </Button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4 last:mb-0">
      <span className="text-sm text-white/75">{label}</span>
      <span className="flex items-center gap-2">{children}</span>
    </div>
  );
}

function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-40 accent-cyan-400"
    />
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-6 w-11 rounded-full transition ${on ? 'bg-cyan-400' : 'bg-white/15'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-all ${on ? 'left-5.5' : 'left-0.5'}`}
      />
    </button>
  );
}
