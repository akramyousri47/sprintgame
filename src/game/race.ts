/**
 * Race engine — pure logic, no Three.js, so it can be driven headlessly in a
 * test and replayed from a seed.
 *
 * Phases
 *   intro     athletes step into the blocks, the camera settles behind them
 *   set       "SET" — everyone is down in the blocks
 *   hold      0.9-1.6 s of dead air. Any movement before the gun is a false start
 *   running   the race: reaction, rhythm, wind, fatigue, the finish dip
 *   results   everyone is home and the table is final
 *
 * Rules enforced here
 *   - a reaction under 100 ms, or any movement before the gun, disqualifies
 *   - stride quality comes from timing taps against the foot-strike clock
 *   - mashing is punished through stride quality, so the athlete overstrides
 *     and the cadence falls away
 *   - a legal dive in the last 15 m is worth up to 0.14 s
 *   - head wind above +2.0 m/s costs speed
 *
 * Start timing is kept on the performance clock (because reaction time is
 * measured against the gun, not against a frame) while the race itself runs on
 * accumulated fixed 120 Hz steps.
 */

import { FINISH, GAIT, START, TRACK, WIND, clamp, lerp, makeRng, smoothstep } from './config';
import { Gait, gradeTap } from '../biomechanics/gait';
import type { GaitEvent, TapGrade } from '../biomechanics/gait';
import { blockPush, sampleReaction } from '../biomechanics/athlete';
import { ATHLETES } from '../data/athletes';
import type { Athlete } from '../data/athletes';
import type { AnimatorState } from '../characters/animator';

export type RacePhase = 'idle' | 'intro' | 'set' | 'hold' | 'running' | 'results';
export type RaceMode = 'quick' | 'career' | 'timeTrial' | 'versus';
export type Outcome = 'win' | 'podium' | 'finished' | 'dnf' | 'dq';

const INTRO_TIME = 2.2;
const SET_TIME = 0.5;
const SAMPLE_DT = 0.05;

/** floats per sample, see the comment on Racer.samples */
export const SAMPLE_STRIDE = 8;
/** how long the finish hangs before the results are forced */
const FINISH_GRACE = 7;
const STEP = 1 / 120;

export interface Racer {
  index: number;
  athlete: Athlete;
  lane: number;
  isPlayer: boolean;
  /** 0 = player one, 1 = player two, -1 = AI */
  playerId: number;
  gait: Gait;
  /** past the reaction window and driving */
  started: boolean;
  reaction: number;
  dq: boolean;
  dqReason: string;
  /** rolling rhythm quality, 0..1 */
  quality: number;
  lastGrade: TapGrade | null;
  /** race time of the last rhythm tap, for the mash detector */
  lastTapAt: number;
  /** AI: seconds until its next tap */
  nextTap: number;
  /** AI ability 0..1 */
  skill: number;
  /** AI: form multiplier drifting over the race */
  form: number;
  formPhase: number;
  finished: boolean;
  finishTime: number;
  /** race time the dive was initiated, -1 if none */
  dipAt: number;
  dipBonus: number;
  dipAmount: number;
  rank: number;
  topSpeed: number;
  /** 20 Hz samples per racer, 8 floats each:
   *  t, distance, dip, quality, stridePhase, speed, stanceFraction, contactTime */
  samples: number[];
  /** rewritten every step; the renderer copies this into the animator */
  anim: AnimatorState;
  contact: GaitEvent | null;
}

export interface RacerResult {
  rank: number;
  name: string;
  nation: string;
  lane: number;
  time: number;
  valid: boolean;
  dqReason: string;
  reaction: number;
  wind: number;
  dip: number;
  topSpeed: number;
  stepLength: number;
  player: boolean;
}

export interface RaceOptions {
  mode: RaceMode;
  seed: number;
  distance: number;
  fieldSize: number;
  playerLane: number;
  playerAthleteId: number;
  /** two player versus only */
  player2Lane: number;
  player2AthleteId: number;
  /** head wind in m/s; +2.0 is the legal limit */
  wind: number;
}

export interface PlayerSnapshot {
  distance: number;
  speed: number;
  quality: number;
  started: boolean;
  dq: boolean;
  dqReason: string;
  reaction: number;
  grade: TapGrade | null;
  rank: number;
  dip: number;
  /** seconds until the next foot strike, for the rhythm meter */
  toStrike: number;
  progress: number;
}

export interface RaceSnapshot {
  phase: RacePhase;
  raceTime: number;
  /** seconds until the gun; counts up once it has fired */
  clock: number;
  player: PlayerSnapshot;
  /** only set in two player versus */
  p2: PlayerSnapshot | null;
  wind: number;
  finishOrder: number[];
  results: RacerResult[] | null;
  message: string;
  messageAt: number;
  /** true in the window where the dive is available */
  dipWindow: boolean;
}

export class Race {
  readonly opts: RaceOptions;
  readonly racers: Racer[] = [];
  readonly player: Racer;
  /** two player versus only */
  readonly player2: Racer | undefined;
  phase: RacePhase = 'idle';
  /** seconds since arm() */
  t = 0;
  /** seconds since the gun */
  raceTime = 0;
  holdTotal = 0;
  /** seconds left on the "SET" hold */
  holdTime = 0;
  /** performance-clock second the gun went off, -1 before that */
  gunAt = -1;
  finishOrder: number[] = [];
  results: RacerResult[] | null = null;
  message = '';
  messageAt = -99;
  private readonly rng: () => number;
  private armClock = 0;
  private accumulator = 0;
  private sampleClock = 0;
  private resultsAt = -1;

  constructor(opts: RaceOptions) {
    this.opts = opts;
    this.rng = makeRng(opts.seed);
    const playerLane = clamp(Math.floor(opts.playerLane), 0, TRACK.lanes - 1);
    const playerId = ((Math.floor(opts.playerAthleteId) % ATHLETES.length) + ATHLETES.length) % ATHLETES.length;
    const twoPlayer = opts.mode === 'versus';
    const p2Id = ((Math.floor(opts.player2AthleteId) % ATHLETES.length) + ATHLETES.length) % ATHLETES.length;

    // AI field: every athlete except the one the player picked, shuffled
    const taken = new Set([playerId]);
    if (twoPlayer) taken.add(p2Id);
    const pool: number[] = [];
    for (let i = 0; i < ATHLETES.length; i++) if (!taken.has(i)) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    // the two players may never share a lane: push player two clear of player one
    const freeLanes: number[] = [];
    for (let l = 0; l < TRACK.lanes; l++) if (l !== playerLane) freeLanes.push(l);
    const p2Lane = twoPlayer
      ? freeLanes[clamp(Math.floor(opts.player2Lane), 0, freeLanes.length - 1)] ?? playerLane
      : -1;
    const fieldSize = clamp(Math.floor(opts.fieldSize), 1, TRACK.lanes);

    let player!: Racer;
    let player2: Racer | undefined;
    let poolAt = 0;
    for (let lane = 0; lane < TRACK.lanes; lane++) {
      const isP1 = lane === playerLane;
      const isP2 = twoPlayer && lane === p2Lane;
      const isPlayer = isP1 || isP2;
      const playerIdForLane = isP1 ? playerId : isP2 ? p2Id : -1;
      const id = isPlayer ? playerIdForLane : (pool[poolAt++] ?? (lane + 1) % ATHLETES.length);
      const athlete = ATHLETES[id % ATHLETES.length];
      const racer: Racer = {
        index: this.racers.length,
        athlete,
        lane,
        isPlayer,
        playerId: isP1 ? 0 : isP2 ? 1 : -1,
        gait: new Gait(athlete.params),
        started: false,
        reaction: 0,
        dq: false,
        dqReason: '',
        quality: 1,
        lastGrade: null,
        lastTapAt: -1,
        nextTap: 0,
        skill: isPlayer ? 1 : clamp(0.72 + this.rng() * 0.23, 0, 1),
        form: isPlayer ? 1 : clamp(0.92 + (this.rng() - 0.5) * 0.18, 0.75, 1),
        formPhase: this.rng() * 6.283,
        finished: false,
        finishTime: 0,
        dipAt: -1,
        dipBonus: 0,
        dipAmount: 0,
        rank: 0,
        topSpeed: 0,
        samples: [],
        anim: emptyAnim(),
        contact: null,
      };
      this.racers.push(racer);
      if (isP1) player = racer;
      else if (isP2) player2 = racer;
    }
    this.player = player;
    this.player2 = player2;

    // honour the requested field size: every human, then AI until it is full
    const kept: Racer[] = this.racers.filter((r) => r.isPlayer);
    for (const r of this.racers) {
      if (kept.length >= fieldSize) break;
      if (!r.isPlayer) kept.push(r);
    }
    // keep the field in lane order so lane N is always the Nth rig on the track
    kept.sort((a, b) => a.lane - b.lane);
    this.racers.length = 0;
    this.racers.push(...kept);
    this.racers.forEach((r, i) => {
      r.index = i;
    });
  }

  /** seconds remaining on the track */
  get remaining(): number {
    return Math.max(0, this.opts.distance - this.player.gait.s.distance);
  }

  arm(): void {
    this.armClock = performance.now() / 1000;
    this.phase = 'intro';
    this.t = 0;
    this.raceTime = 0;
    this.gunAt = -1;
    this.finishOrder = [];
    this.results = null;
    this.resultsAt = -1;
    this.sampleClock = 0;
    this.accumulator = 0;
    this.holdTime = 0;
    for (const r of this.racers) {
      r.gait.reset();
      r.started = false;
      r.reaction = 0;
      r.dq = false;
      r.dqReason = '';
      r.quality = 1;
      r.lastTapAt = -1;
      r.lastGrade = null;
      r.finished = false;
      r.finishTime = 0;
      r.dipAt = -1;
      r.dipBonus = 0;
      r.dipAmount = 0;
      r.rank = 0;
      r.topSpeed = 0;
      r.samples.length = 0;
      r.nextTap = 0;
      r.contact = null;
      r.anim = emptyAnim();
    }
  }

  /**
   * Handle a physical input. `at` is the performance clock in seconds, taken
   * from the DOM event rather than the frame, so reaction time is honest.
   * `who` is 0 for player one, 1 for player two.
   */
  input(action: 'react' | 'left' | 'right' | 'dip', at: number, who: 0 | 1 = 0): void {
    const p = who === 0 ? this.player : this.player2;
    if (!p || p.dq) return;
    const sinceGun = this.gunAt < 0 ? -1 : at - this.gunAt;

    if (action === 'react') {
      if (this.phase === 'intro' || this.phase === 'set' || this.phase === 'hold') {
        this.disqualify(p, 'False start — moved before the gun');
        this.say('False start');
        return;
      }
      if (this.phase === 'running' && !p.started) {
        p.reaction = Math.max(0, sinceGun);
        if (p.reaction < START.falseStartThreshold) {
          this.disqualify(p, `Reaction ${(p.reaction * 1000).toFixed(0)} ms — inside the 100 ms limit`);
          this.say('False start');
          return;
        }
        p.started = true;
        p.gait.launchFromBlocks(blockPush(p.athlete.params.start, p.athlete.height) * 0.55);
        this.say('Go');
      }
      return;
    }

    if (!p.started || this.phase !== 'running') return;

    if (action === 'dip') {
      const remaining = this.opts.distance - p.gait.s.distance;
      if (remaining <= FINISH.dipWindow && remaining > 0.3 && p.dipAt < 0) {
        p.dipAt = this.raceTime;
        // the closer to the line, the more of the dive is worth something
        p.dipBonus = FINISH.dipBonusTime * clamp(1 - remaining / FINISH.dipWindow, 0.25, 1);
        this.say('Dive');
      }
      return;
    }

    // --- rhythm tap: grade against the foot-strike clock -------------
    if (action === 'left' !== (p.gait.expected === 'left')) {
      // wrong foot: a real attempt, but it scores nothing
      p.quality = Math.max(0, p.quality - 0.07);
      p.lastGrade = 'early';
      return;
    }
    const res = gradeTap(p.gait.s.timeToStrike, p.lastTapAt < 0 ? 99 : this.raceTime - p.lastTapAt);
    p.lastGrade = res.grade;
    p.quality = clamp(lerp(p.quality, res.quality, res.grade === 'mash' ? 0.9 : 0.5), 0, 1);
    p.lastTapAt = this.raceTime;
  }

  /** advance the simulation; `dt` is wall-clock seconds */
  update(dtRaw: number): void {
    if (this.phase === 'idle') return;
    this.accumulator += Math.min(dtRaw, 0.1);
    let guard = 0;
    while (this.accumulator >= STEP && guard++ < 16) {
      this.accumulator -= STEP;
      this.step(STEP);
    }
  }

  private say(msg: string): void {
    this.message = msg;
    this.messageAt = this.raceTime;
  }

  private disqualify(r: Racer, reason: string): void {
    r.dq = true;
    r.dqReason = reason;
    r.started = false;
    r.quality = 0;
  }

  private step(dt: number): void {
    this.t += dt;

    /* --- start sequence ------------------------------------------- */
    if (this.phase === 'intro') {
      if (this.t >= INTRO_TIME) {
        this.phase = 'set';
        this.t = 0;
        this.holdTotal = lerp(START.holdMin, START.holdMax, this.rng());
        this.holdTime = this.holdTotal;
        for (const r of this.racers) {
          r.reaction = sampleReaction(this.rng, r.athlete.params.start) * lerp(1.18, 0.92, r.skill);
        }
        this.say('Set');
      }
    } else if (this.phase === 'set') {
      if (this.t >= SET_TIME) {
        this.phase = 'hold';
        this.t = 0;
        this.holdTime = this.holdTotal;
        this.say('Set');
      }
    } else if (this.phase === 'hold') {
      this.holdTime = Math.max(0, this.holdTotal - this.t);
      if (this.t >= this.holdTotal) {
        this.phase = 'running';
        this.gunAt = this.armClock + INTRO_TIME + SET_TIME + this.holdTotal;
        this.raceTime = 0;
        this.say('Go');
      }
    } else {
      this.raceTime += dt;
    }

    const live = this.phase === 'running';

    /* --- AI -------------------------------------------------------- */
    if (live) {
      for (const r of this.racers) {
        if (r.isPlayer || r.dq) continue;
        if (!r.started) {
          if (this.raceTime >= r.reaction) {
            r.started = true;
            r.gait.launchFromBlocks(blockPush(r.athlete.params.start, r.athlete.height) * lerp(0.92, 1, r.skill));
          }
          continue;
        }
        this.stepAI(r, dt);
      }
    }

    /* --- locomotion ------------------------------------------------ */
    for (const r of this.racers) {
      const g = r.gait;
      // wind: a tailwind helps a little, a legal-limit headwind costs speed
      const over = Math.max(0, this.opts.wind - WIND.legalLimit) * 0.005;
      const tail = Math.min(0.004, Math.max(0, -this.opts.wind) * 0.0022);
      g.s.maxSpeed = g.p.maxSpeed * (1 - over + tail);
      const ev = g.step(dt, {
        quality: clamp(r.quality, 0, 1),
        driving: r.started && !r.dq && !r.finished,
        stalled: !r.started || r.dq,
      });
      r.contact = ev.contact ? ev : null;
      if (g.s.speed > r.topSpeed) r.topSpeed = g.s.speed;
      const want = r.dipAt >= 0 ? clamp((this.raceTime - r.dipAt) / 0.22, 0, 1) : 0;
      r.dipAmount = lerp(r.dipAmount, want, 1 - Math.exp(-14 * dt));
    }

    /* --- finish ---------------------------------------------------- */
    if (live) {
      for (const r of this.racers) {
        if (r.finished || r.dq || !r.started) continue;
        if (r.gait.s.distance >= this.opts.distance) {
          r.finished = true;
          r.finishTime = Math.max(0, this.raceTime - r.dipBonus);
          this.finishOrder.push(r.index);
          if (r.isPlayer) {
            const place = this.finishOrder.length;
            const who = r.playerId === 1 ? 'P2' : 'P1';
            this.say(place === 1 ? `${who} wins` : `${who} P${place}`);
          }
        }
      }
      if (this.finishOrder.length > 0) {
        if (this.resultsAt < 0) this.resultsAt = this.raceTime;
        const allHome = this.racers.every((r) => r.dq || r.finished);
        if (allHome || this.raceTime - this.resultsAt > FINISH_GRACE) this.finish();
      }
    }

    /* --- sampling for replay and ghost ----------------------------- */
    if (live) {
      this.sampleClock += dt;
      while (this.sampleClock >= SAMPLE_DT) {
        this.sampleClock -= SAMPLE_DT;
        for (const r of this.racers) {
          const g = r.gait.s;
          r.samples.push(
            this.raceTime,
            g.distance,
            r.dipAmount,
            r.quality,
            g.stridePhase,
            g.speed,
            g.stanceFraction,
            g.contactTime,
          );
        }
      }
    }

    this.writeAnim();
  }

  private stepAI(r: Racer, dt: number): void {
    const g = r.gait;
    // form drifts so the field does not run on a metronome
    r.formPhase += dt * (0.5 + r.skill * 0.6);
    const wobble = Math.sin(r.formPhase) * 0.5 + Math.sin(r.formPhase * 0.37) * 0.5;
    const drag = 1 - smoothstep((g.s.distance - 65) / 35) * (1 - r.athlete.params.endurance) * 0.3;
    const target = clamp((0.84 + wobble * 0.11) * r.form * r.skill * drag, 0.35, 1);
    r.quality = lerp(r.quality, target, 1 - Math.exp(-3 * dt));

    r.nextTap -= dt;
    if (r.nextTap <= 0) {
      const jitter = (1 - r.skill) * 0.07;
      r.nextTap = clamp(g.s.timeToStrike + (this.rng() - 0.5) * jitter * 2, 0.09, 0.4);
      r.lastGrade = this.rng() < r.skill ? 'perfect' : this.rng() < 0.7 ? 'good' : 'ok';
    }

    // a well-placed AI takes the dive on the line
    const left = this.opts.distance - g.s.distance;
    if (left < FINISH.dipWindow && left > 1.2 && r.dipAt < 0 && this.rng() < 0.9 * r.skill * dt) {
      r.dipAt = this.raceTime;
      r.dipBonus = FINISH.dipBonusTime * 0.8;
    }
  }

  private finish(): void {
    this.phase = 'results';
    const rows: RacerResult[] = this.racers.map((r) => ({
      rank: 0,
      name: r.athlete.name,
      nation: r.athlete.nation.code,
      lane: r.lane + 1,
      time: r.finished ? r.finishTime : Number.POSITIVE_INFINITY,
      valid: r.finished && !r.dq,
      dqReason: r.dqReason,
      reaction: r.reaction,
      wind: this.opts.wind,
      dip: r.dipBonus,
      topSpeed: r.topSpeed,
      stepLength: r.gait.strideLength,
      player: r.isPlayer,
    }));
    rows.sort((a, b) => {
      if (a.valid !== b.valid) return a.valid ? -1 : 1;
      if (a.valid && b.valid && a.time !== b.time) return a.time - b.time;
      return a.lane - b.lane;
    });
    rows.forEach((row, i) => {
      row.rank = row.valid ? i + 1 : 0;
    });
    for (const r of this.racers) {
      r.rank = rows.find((x) => x.lane === r.lane + 1)?.rank ?? 0;
    }
    this.results = rows;
    this.say('Finish');
  }

  private writeAnim(): void {
    const preGun = this.phase === 'intro' || this.phase === 'set' || this.phase === 'hold';
    for (const r of this.racers) {
      const g = r.gait.s;
      const crouch = preGun || (r.dq && !r.finished) ? 1 : 0;
      r.anim = {
        distance: Math.min(g.distance, this.opts.distance + 8),
        laneX: (r.lane - (TRACK.lanes - 1) / 2) * TRACK.laneWidth,
        speed: g.speed,
        stridePhase: g.stridePhase,
        stanceFrac: g.stanceFraction,
        strikeFrac: clamp((g.stepLength - GAIT.stepLengthMin) / (GAIT.stepLengthMax - GAIT.stepLengthMin), 0, 1),
        quality: clamp(r.quality, 0, 1),
        fatigue: g.fatigue,
        lean: g.lean,
        contactTime: g.contactTime,
        drive: g.driveAmount,
        crouch,
        launch: r.started ? clamp(1 - g.distance / 16, 0, 1) : 0,
        dip: r.dipAmount,
        t: this.raceTime,
      };
    }
  }

  /** the dip window is open from 15 m out to the line */
  get dipAvailable(): boolean {
    const left = this.opts.distance - this.player.gait.s.distance;
    return this.phase === 'running' && !this.player.dq && left <= FINISH.dipWindow && left > 0.3;
  }

  snapshot(): RaceSnapshot {
    const shot = (p: Racer): PlayerSnapshot => ({
      distance: p.gait.s.distance,
      speed: p.gait.s.speed,
      quality: p.quality,
      started: p.started,
      dq: p.dq,
      dqReason: p.dqReason,
      reaction: p.reaction,
      grade: p.lastGrade,
      rank: p.rank,
      dip: p.dipAmount,
      toStrike: p.started ? p.gait.s.timeToStrike : 0,
      progress: clamp(p.gait.s.distance / this.opts.distance, 0, 1),
    });
    return {
      phase: this.phase,
      raceTime: this.raceTime,
      clock: this.phase === 'running' || this.phase === 'results' ? this.raceTime : this.holdTime,
      player: shot(this.player),
      p2: this.player2 ? shot(this.player2) : null,
      wind: this.opts.wind,
      finishOrder: this.finishOrder,
      results: this.results,
      message: this.message,
      messageAt: this.messageAt,
      dipWindow: this.dipAvailable,
    };
  }
}

function emptyAnim(): AnimatorState {
  return {
    distance: 0,
    laneX: 0,
    speed: 0,
    stridePhase: 0,
    stanceFrac: GAIT.stanceStart,
    strikeFrac: 0,
    quality: 1,
    fatigue: 0,
    lean: 12,
    contactTime: GAIT.contactMax,
    drive: 1,
    crouch: 1,
    launch: 0,
    dip: 0,
    t: 0,
  };
}
