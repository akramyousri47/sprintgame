/**
 * Game app: the frame loop and the wiring between the engine, the stage, the
 * audio, the input and the UI store.
 *
 * The loop order matters and is fixed:
 *   poll input -> advance the race -> draw -> fire audio cues -> publish a
 *   throttled snapshot. React never runs in the hot path; it only reads the
 *   snapshot.
 */

import { audio } from '../audio/audio';
import { Stage } from '../render/stage';
import { Race } from './race';
import type { RaceMode, RaceOptions } from './race';
import { SAMPLE_STRIDE } from './race';
import { InputManager } from './input';
import { useGame } from '../state/store';
import type { Screen } from '../state/store';
import { FINISH, TRACK, clamp } from './config';
import type { GhostData } from '../render/field';
import type { Athlete } from '../data/athletes';

const LIVE_HZ = 30;
/** the photo-finish replay drops to a quarter speed */
const REPLAY_SLOWMO = 0.25;

export class GameApp {
  private readonly input = new InputManager();
  private race!: Race;
  private stage!: Stage;
  private canvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private last = 0;
  private liveClock = 0;
  private paused = false;
  private resultRecorded = false;
  private finishAudioPlayed = false;
  private gunAudioPlayed = false;
  private replaying = false;
  private replayIndex = 0;
  private ghost: GhostData | null = null;
  private focusIndex = 0;

  /** true once the first frame has been drawn */
  ready = false;

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const s = useGame.getState();
    this.race = new Race(this.optionsFor(s.mode, s));
    this.stage = new Stage(canvas, { quality: s.settings.quality, race: this.race });
    this.stage.setGhost(this.ghost);
    this.input.attach();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private optionsFor(mode: RaceMode, s: ReturnType<typeof useGame.getState>): RaceOptions {
    return {
      mode,
      seed: s.seed,
      distance: mode === 'career' ? s.distance : TRACK.raceDistance,
      fieldSize: mode === 'timeTrial' ? 1 : mode === 'versus' ? 2 : s.fieldSize,
      playerLane: clamp(s.playerLane, 0, TRACK.lanes - 1),
      playerAthleteId: s.playerAthleteId,
      player2Lane: clamp(s.player2Lane, 0, TRACK.lanes - 1),
      player2AthleteId: s.player2AthleteId,
      wind: mode === 'career' ? 0 : s.wind,
    };
  }

  /** rebuild the world for a new race configuration */
  private rebuild(): void {
    const s = useGame.getState();
    const old = this.stage;
    this.race = new Race(this.optionsFor(s.mode, s));
    this.stage = new Stage(this.canvas as HTMLCanvasElement, { quality: s.settings.quality, race: this.race });
    this.stage.setGhost(this.ghost);
    old.dispose();
  }

  startRace(): void {
    const s = useGame.getState();
    s.patch({
      seed: (s.seed * 1664525 + 1013904223) >>> 0,
      results: null,
      lastTime: null,
      isPb: false,
    });
    this.rebuild();
    this.resultRecorded = false;
    this.finishAudioPlayed = false;
    this.gunAudioPlayed = false;
    this.replaying = false;
    this.paused = false;
    this.focusIndex = 0;
    this.stage.setGhost(this.ghost);
    this.stage.field.setLiveVisible(true);
    useGame.getState().setPaused(false);
    useGame.getState().setReplaying(false);
    this.race.arm();
    if (s.settings.cameraShake) this.stage.kick(0.5);
    s.setScreen('race');
  }

  /** load a recorded run to race against, or clear it with null */
  setGhost(ghost: GhostData | null): void {
    this.ghost = ghost;
    this.stage?.setGhost(ghost);
  }

  /**
   * Replay the last stretch of a lane in slow motion, using the 20 Hz samples
   * the engine recorded. The live rigs are hidden so the replay is the only
   * athlete on the track.
   */
  startReplay(lane: number): void {
    const index = this.race.racers.findIndex((r) => r.lane === lane);
    if (index < 0) return;
    const racer = this.race.racers[index];
    if (!racer || racer.samples.length < 16) return;
    const start = Math.max(0, racer.finishTime - FINISH.replayWindow);
    // cut the sample track to the replay window and rebase it onto zero
    const raw = racer.samples;
    let i0 = 0;
    while (i0 < raw.length && raw[i0] < start) i0 += 8;
    const samples = raw.slice(i0);
    for (let i = 0; i < samples.length; i += 8) samples[i] -= start;
    this.stage.setGhost({
      athleteIndex: racer.athlete.id,
      lane: racer.lane,
      samples,
      time: Math.max(0, racer.finishTime - start),
    });
    this.stage.field.setLiveVisible(false);
    this.replaying = true;
    this.replayIndex = index;
    this.stage.field.rewindGhost();
    useGame.getState().setReplaying(true);
  }
  stopReplay(): void {
    this.replaying = false;
    this.stage?.setGhost(this.ghost);
    this.stage?.field.setLiveVisible(true);
    useGame.getState().setReplaying(false);
  }

  get isReplaying(): boolean {
    return this.replaying;
  }

  get replayAthlete(): Athlete | undefined {
    return this.race.racers[this.replayIndex]?.athlete;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    useGame.getState().setPaused(p);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** a touch-screen button press, routed through the same queue as the keys */
  pushTouch(action: 'react' | 'left' | 'right' | 'dip', player: 0 | 1 = 0): void {
    this.input.touch(action, player);
  }

  setScreen(screen: Screen): void {
    useGame.getState().setScreen(screen);
  }

  setQuality(q: ReturnType<typeof useGame.getState>['settings']['quality']): void {
    this.stage?.setQuality(q);
  }

  /**
   * Confirm / back, so the whole thing is playable from the keyboard. These are
   * ignored while racing, where they would fight the sprint inputs, and they
   * never fire on the very first frame, which would otherwise launch a race
   * from whatever key the user last pressed.
   */
  private menuKey(action: string): void {
    if (action !== 'confirm' && action !== 'back') return;
    const st = useGame.getState();
    if (st.screen === 'race' || st.screen === 'results') return;
    if (!this.ready) return;
    if (action === 'back') {
      const back: Partial<Record<Screen, Screen>> = {
        athlete: 'title',
        lane: 'athlete',
        career: 'title',
        settings: 'title',
        help: 'title',
      };
      const to = back[st.screen];
      if (to) {
        st.setScreen(to);
        return;
      }
    }
    // confirm advances along the same path the on-screen primary button takes:
    // Enter on the title screen is a quick race, exactly as the title promises
    if (st.screen === 'title') {
      st.patch({ mode: 'quick' });
      st.setScreen('athlete');
    } else if (st.screen === 'help' || st.screen === 'settings' || st.screen === 'career') {
      st.setScreen('title');
    } else if (st.screen === 'athlete') {
      st.setScreen('lane');
    }
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(0.05, Math.max(0.0001, raw));

    /* 1. input */
    this.input.pollGamepads();
    for (const ev of this.input.drain()) {
      if (ev.action === 'react' || ev.action === 'left' || ev.action === 'right' || ev.action === 'dip') {
        if (!this.paused && !this.replaying) this.race.input(ev.action, ev.at, ev.player);
      } else if (ev.action === 'debug') {
        const st = useGame.getState();
        st.patchSettings({ showDebug: !st.settings.showDebug });
      } else if (ev.action === 'pause') {
        this.setPaused(!this.paused);
      } else {
        this.menuKey(ev.action);
      }
    }

    /* 2. simulate */
    const simDt = this.paused ? 0 : this.replaying ? dt * REPLAY_SLOWMO : dt;
    if (simDt > 0) this.race.update(simDt);

    /* 3. draw (this also advances the rigs and fills the contact list) */
    this.stage.render(simDt, this.replaying ? -1 : this.focusIndex);

    /* 4. audio, driven by what just happened in the world */
    this.updateAudio(simDt);

    /* 5. publish to the UI */
    this.liveClock += dt;
    if (this.liveClock >= 1 / LIVE_HZ) {
      this.liveClock = 0;
      this.publish();
    }
    this.ready = true;
  };

  private updateAudio(simDt: number): void {
    if (this.paused || !audio.ready) return;
    const race = this.race;
    const p = race.player;
    const running = race.phase === 'running' || race.phase === 'results';
    const tension = race.phase === 'hold' ? 0.25 : clamp(0.35 + p.gait.s.speed / 14, 0, 1);
    const vol = useGame.getState().settings.crowdVolume;
    audio.setCrowd((running ? 0.6 : 0.32) * vol, tension);

    // the gun is a one-shot: it fires on the frame the engine turns running
    if (race.phase === 'running' && !this.gunAudioPlayed) {
      this.gunAudioPlayed = true;
      audio.shot();
    }

    if (race.finishOrder.length > 0 && !this.finishAudioPlayed) {
      this.finishAudioPlayed = true;
      const lead = this.race.racers[race.finishOrder[0]];
      audio.cheer(lead?.isPlayer ? 1 : 0.7);
      audio.bell();
    }

    // spike transients, quieter for athletes further down the track
    const focusZ = this.replaying ? 0 : p.anim.distance;
    for (const c of this.stage.field.drainContacts()) {
      const d = Math.abs(focusZ - c.z);
      audio.step(c.load, d < 7 ? 1 : 0.3);
    }

    audio.updateBreath(simDt, clamp(p.gait.s.speed / 12 + p.gait.s.fatigue * 0.3, 0, 1.2));
  }

  private publish(): void {
    const s = useGame.getState();
    s.setLive(this.race.snapshot());
    const st = this.stage.stats;
    s.patch({
      perf: {
        fps: st.fps,
        calls: st.calls,
        triangles: st.triangles,
        scale: st.scale,
        drawMs: this.stage.renderMs,
      },
    });

    if (this.race.phase === 'results' && !this.resultRecorded) {
      this.resultRecorded = true;
      const p = this.race.player;
      const time = p.finished && !p.dq ? p.finishTime : null;
      const isPb = s.recordResult(time, p.athlete.id, this.race.results);
      s.patch({ screen: 'results' });
      // a time trial PB is kept as the ghost to race next time
      if (s.mode === 'timeTrial' && isPb && time !== null) this.captureGhost(p.athlete.id, p.lane, p.samples);
    }
  }

  /**
   * Keep a finished run as the ghost for the next time trial. Samples are
   * stored in memory only: they are large, and a personal best is a local,
   * single-run thing rather than a profile to persist.
   */
  private captureGhost(athleteIndex: number, lane: number, samples: number[]): void {
    if (samples.length < SAMPLE_STRIDE) return;
    const copy = samples.slice();
    // the last sample's leading float is the race time the run ended at
    const time = copy[copy.length - SAMPLE_STRIDE] ?? 0;
    this.setGhost({ athleteIndex, lane, samples: copy, time });
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.stage?.dispose();
    audio.dispose();
  }
}

let instance: GameApp | null = null;

export function gameApp(): GameApp {
  if (!instance) instance = new GameApp();
  return instance;
}
