# Global Sprint Games

An original browser sprint game. Pick an athlete, take your lane, react to the gun, and
drive the rhythm of the run to the line. Everything you see is generated in code: the
humanoids, the stadium, the flags, and the sound.

> Every nation, athlete, and flag in this project is fictional. "Global Sprint Games" is
> not affiliated with, endorsed by, or associated with any real sporting body or event.

## Running it

```bash
npm install
npm run dev      # http://127.0.0.1:5199
```

```bash
npm run typecheck  # tsc --noEmit, strict
npm test           # vitest, 61 tests
npm run build      # tsc && vite build
npm run preview
```

## Modes

| Mode | What it does |
| --- | --- |
| **Quick Race** | 8-lane 100 m against the full field, wind of your choosing. |
| **Time Trial** | You alone, against your own personal best run as a ghost. |
| **2 Player** | Two athletes, two lanes, no AI. Head to head. |
| **Career** | Heat → semi-final → final. Top two advance; the final's top three take a medal. |

## Controls

### P1

| Action | Keys |
| --- | --- |
| React to the gun | `Space` |
| Tap feet | `A` / `D` or `←` / `→` |
| Dive for the line | `S` or `↓`, inside the last 15 m |
| Pause | `P` |
| Debug overlay | `F3` |

### P2 (2 Player mode)

| Action | Keys |
| --- | --- |
| React | `Right Shift` or `Numpad 0` |
| Tap feet | `J` / `L` |
| Dive | `K` |

### Menus

`Enter` confirms and advances, `Escape` goes back. On the title screen `Enter` starts a
quick race. Every menu is also fully clickable, and the sprint screens have on-screen
touch buttons.

### Gamepads

The first connected gamepad is P1, the second is P2. D-pad or left stick to tap, `A` /
cross to react, `B` to dive.

## The start

React too early and you are disqualified. The rules the engine enforces:

- Hold the set position for **0.9 s to 1.6 s**, drawn per race.
- A reaction faster than **0.100 s** after the gun is a false start.
- A late start is legal, it just costs you the race.

## Driving the rhythm

Speed comes from contact quality, not from mashing. Each step is graded on how close the
tap is to the ideal strike, and the grades compound:

- Perfect and clean strikes build rhythm and cut the cost of running fast.
- Sloppy timing raises fatigue, which bleeds top speed over the distance.
- Overstriding — striking too far ahead of the body — is penalised hard, and a tired
  athlete overstrides more easily.

Tapping in time is faster than tapping as often as possible. Watch the meter in the HUD.

A dive inside the last 15 m buys back time, but only if it is inside the window.

## Architecture

```
src/
  biomechanics/   gait model, athlete params, leg IK, pose clips
  characters/     procedural humanoid rig and animator
  data/           fictional nations, athletes, procedural flags
  game/           race engine, input, app loop, tuning config
  render/         three.js stage, track, stadium, field, camera
  ui/             React screens and HUD
  state/          persisted Zustand store
```

The layering is strict and one-directional:

- `race.ts` is pure logic. It owns the state machine, the AI, wind, fatigue, results, and
  the 20 Hz replay samples, and it never touches the DOM, three.js, or audio.
- `field.ts` maps racers onto humanoid rigs. It advances animation and produces the
  ground-contact events that the audio layer consumes.
- `stage.ts` owns the renderer, camera, and world.
- `app.ts` is the only place that runs a frame loop: input → simulation → render → audio →
  throttled UI publish.
- The Zustand store is the only thing the React tree reads, and it is written at 30 Hz
  rather than every frame, so the UI never causes a React render in the hot path.

## The gait model

The model is deliberately physical rather than a speed curve with an animation on top:

- Stride phase and ground contact advance with **distance travelled**, not time, so foot
  placement stays locked to the ground at any speed.
- The acceleration envelope is **time-based**, so the drive out of the blocks is the same
  regardless of how far the athlete has run.
- Cadence and step length satisfy `v = stepFrequency × stepLength`. A fast athlete reaches
  roughly 4.5–5 Hz at full speed with 2.2–2.5 m steps; slower athletes take shorter,
  quicker steps.
- The foot is **placed, not animated**. The ball of the foot stays planted and the ankle
  rolls over it while the body travels on, which is what real sprinting does and what
  stops the shoe skating. At 10 m/s with a 0.10 s contact the body passes 1.0 m over the
  foot, far more than a leg can swing, so the roll is what makes it work.
- Toe-off is capped at the furthest point the leg can actually reach. Without that cap the
  raw roll-over throws the ankle over a metre behind the hip and the leg visibly
  over-extends.
- The IK solver is two-bone and analytic in the sagittal plane, with a pole that selects
  which way the knee bulges.

## Tuning

All gameplay numbers live in `src/game/config.ts`: track and lane geometry, gait limits,
start rules, finish and dive windows, wind, rhythm grading, fatigue, render quality
presets, dynamic resolution, and the camera. There are no magic numbers scattered through
the systems code.

## Tests

61 tests, all passing.

- `tests/gait.test.ts` — cadence/step-length coupling, acceleration, fatigue, rhythm
  grading, overstriding.
- `tests/race.test.ts` — start hold window, false start, reaction, field sizing per mode,
  versus lane separation, finish, dive bonus, determinism.
- `tests/ik.test.ts` — bone lengths, ankle-on-target, knee pole, reach clamping, stance
  geometry limits, foot roll-over, pelvis height, and the agreement between the three.

## Storage

`localStorage`, three keys:

- `gsg.settings.v1` — quality, volumes, camera shake, debug overlay
- `gsg.bests.v1` — personal bests per athlete
- `gsg.career.v1` — career stage, round, history, medal
