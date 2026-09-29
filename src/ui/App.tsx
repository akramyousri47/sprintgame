/**
 * Top-level UI router. The canvas sits behind everything and keeps rendering
 * in every screen, so the stadium is the menu background too.
 */

import { useEffect, useRef } from 'react';
import { audio } from '../audio/audio';
import { gameApp } from '../game/app';
import { useGame } from '../state/store';
import { TitleScreen } from './TitleScreen';
import { AthleteScreen } from './AthleteScreen';
import { LaneScreen } from './LaneScreen';
import { Hud } from './Hud';
import { ResultsScreen } from './ResultsScreen';
import { SettingsScreen } from './SettingsScreen';
import { CareerScreen } from './CareerScreen';
import { HelpScreen } from './HelpScreen';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const screen = useGame((s) => s.screen);
  const muted = useGame((s) => s.settings.muted);
  const volume = useGame((s) => s.settings.volume);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    gameApp().mount(canvas);
    return () => gameApp().dispose();
  }, []);

  useEffect(() => {
    audio.setMuted(muted);
    audio.setVolume(volume);
  }, [muted, volume]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink text-white">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {screen === 'title' && <TitleScreen />}
      {screen === 'athlete' && <AthleteScreen />}
      {screen === 'lane' && <LaneScreen />}
      {screen === 'career' && <CareerScreen />}
      {screen === 'help' && <HelpScreen />}
      {screen === 'settings' && <SettingsScreen />}
      {screen === 'race' && <Hud />}
      {screen === 'results' && <ResultsScreen />}
    </div>
  );
}
