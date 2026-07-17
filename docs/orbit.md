# orbit

Endless-survival browser game at `/orbit`: thrust a planet around, keep its moon in orbit, dodge asteroids. Score = seconds survived. One Phaser 3.90 scene; the only page on the site that ships client-side JavaScript.

Files: `src/pages/orbit.astro` (page shell), `src/scripts/orbit.ts` (all game code).

## How to play

- **Desktop:** `WASD` / arrow keys apply thrust. The planet has momentum — it drifts and decelerates, it does not stop with the key.
- **Touch:** press anywhere and drag — a floating joystick appears at the touch point; the drag vector is the thrust.
- **Start:** the page loads a start screen (idle sim + `tutorial` button). Any key or tap starts a run; tapping `tutorial` starts a three-step interactive tutorial (move → burn and recover → dodge one asteroid). `skip tutorial →` jumps straight into a run.
- **Restart:** after game over, tap or press `R` / `Space` / `Enter`. Restart goes directly into a new run; the start screen appears only on page load.

A run ends three ways:

1. An asteroid touches the planet.
2. An asteroid touches the moon.
3. The moon crosses the **limit ring** — the gray circle at 2.5× the starting orbit radius, centered on the planet.

## Mechanics

**Moon.** The moon orbits under real inverse-square gravity and reacts passively to planet movement — drag the planet and the orbit deforms. Orbital speed follows Kepler: at 1.6× the starting radius the measured angular speed is 0.50× (theory: 1.6^-1.5 = 0.49).

**Danger telegraph.** One 0–1 value, `danger`, drives the moon trail color zinc → amber (0.5) → red (1.0). It is the maximum of two signals:

- _energy danger_ — specific orbital energy `E = |v_moon − v_planet|²/2 − GM/r`, normalized from the starting circular orbit (`0`) to escape energy (`1`). Rises with hard burns before the moon visibly strays: the leading indicator.
- _distance danger_ — moon distance from the planet, normalized from 1.4× orbit radius (`0`) to the limit ring (`1`). Guarantees the trail is red exactly when the moon reaches the ring.

The limit ring itself fades in from 1.4× to 2.2× orbit radius and fades out when the moon returns. The ring is the loss line; the colors are the warning.

**Recovery assist.** Gravity is conservative: without help, every thrust pulse pumps orbital energy that never decays, so `danger` ratchets up and any play style eventually loses the moon (measured during development with the assist disabled: a held burn escaped in 0.8 s; pulsed thrust died inside 12 s). The assist bleeds the moon's velocity toward the planet's, only while `danger` is inside `assistZone` [0.5, 0.95], with a sine-bump strength profile that peaks mid-zone and fades to zero at 0.95 — grazes recover, sustained burns punch through. Measured with assist: pulsed 400 ms burns survive indefinitely (peak danger 0.05); a continuously held burn drags the moon across the ring in ~6.8 s.

**Asteroids.** Straight-line drift, no gravity. Spawn at a random point on a random screen edge, aimed at a random point in the central 60% of the screen. Spawn interval ramps 2.5 s → 0.35 s and speed 0.12 → 0.30 ×u/s (±25% jitter) over the first 90 s of a run; live cap 40. Collision is a circle-circle distance check.

**Tutorial.** Cannot be failed: the assist stays active past the red line (floor 0.25, 1.2× strength) so the moon always returns, and an asteroid hit explodes, shows "try again", and respawns the rock instead of ending the run.

## Tuning guide

Every gameplay number lives in `CONFIG` at the top of `src/scripts/orbit.ts`. Lengths are fractions of `u = min(viewport width, height)` px, speeds ×u/s, accelerations ×u/s² — one feel across phone and desktop. Edit, save; the dev server hot-reloads.

| Key                                 | Value         | Effect of raising it                                                                              |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `planet.radius`                     | 0.03          | Bigger target for asteroids                                                                       |
| `planet.thrust`                     | 0.3           | Snappier movement; easier to out-run the moon's gravity and lose it                               |
| `planet.damping`                    | 1.0           | Stops faster; lowers terminal speed (`thrust / damping` = 0.3 ×u/s)                               |
| `moon.radius`                       | 0.012         | Bigger target for asteroids                                                                       |
| `moon.orbitRadius`                  | 0.18          | Wider starting orbit; the limit ring scales with it                                               |
| `moon.period`                       | 6             | Calmer, slower orbit — but `GM ∝ 1/period²`, so binding weakens; retune `planet.thrust` alongside |
| `escape.ring.radius`                | 2.5           | More room before the moon is lost (loss line, ×`orbitRadius`)                                     |
| `escape.ring.fadeStart` / `fadeEnd` | 1.4 / 2.2     | Where the ring starts / finishes fading in (×`orbitRadius`)                                       |
| `escape.assistZone`                 | [0.5, 0.95]   | Danger range where the recovery assist acts                                                       |
| `escape.assistStrength`             | 0.55          | Stronger self-recovery from grazes (1/s peak bleed)                                               |
| `asteroids.speed`                   | [0.12, 0.30]  | Asteroid speed at 0 s → `rampTime` (×u/s)                                                         |
| `asteroids.interval`                | [2.5, 0.35]   | Seconds between spawns at 0 s → `rampTime`                                                        |
| `asteroids.rampTime`                | 90            | Seconds of survival until full difficulty                                                         |
| `asteroids.radius`                  | [0.008, 0.02] | Asteroid size range                                                                               |
| `asteroids.max`                     | 40            | Live asteroid cap                                                                                 |

Acceptance bar after retuning (checked with the harness in Verification):

1. Pulsed 400 ms burns survive indefinitely, peak danger ≤ 0.6.
2. A continuously held burn loses the moon in 2–7 s.
3. Terminal speed (`planet.thrust / planet.damping`) ≥ 0.8× `asteroids.speed[1]`, or late-game dodging fails.

Constants outside `CONFIG` (edit in place if needed): physics step clamp 50 ms with 2 substeps, gravity softening ε = planet radius, danger smoothing 10/s, trail 40 points sampled every 25 ms, joystick radius 0.07 ×u, asteroid cull margin 0.12 ×u, tutorial asteroid 1.5× `asteroids.speed[0]`.

## Architecture

- `src/pages/orbit.astro` is a standalone document, not a `Base.astro` page: the game must not scroll, has no footer, and needs `touch-action: none` on the canvas container. It loads the site fonts and `global.css`, overlays a home link, and imports `src/scripts/orbit.ts` in a client `<script>`.
- The game boots after `document.fonts.ready` so Phaser canvas text renders in JetBrains Mono on the first frame.
- One scene, four modes: `menu` (idle sim + start UI), `tutorial`, `run`, `over`. Mode transitions: menu → run happens in place so the dismissing tap can seed the joystick; every other entry into a run is `scene.restart({ mode: "run" })`, which re-runs `create()` as the single reset path. Gotcha: Phaser's `restart()` without arguments reuses the previous start data — always pass `{ mode }` explicitly.
- Physics: `a = -GM·r̂/r²` integrated with semi-implicit Euler — velocity before position (plain Euler spirals outward). `GM = (2π·orbitRadius / period)² · orbitRadius`, derived from `CONFIG`, so the period is exact at the starting radius. Softening (`r² + ε²`) prevents a numeric blow-up when the moon is dragged through the planet.
- Sizing: `Phaser.Scale.RESIZE` fills the viewport; every constant derives from `u` per `deriveConstants()`. On resize, constants re-derive and asteroid sizes/velocities rescale; mid-run resizes (mobile URL bar) shift `GM` slightly — accepted.
- Art: two runtime-generated textures (`disc`, jittered-polygon `rock`) tinted per object — no asset files. Swap them for SVGs by loading real textures and deleting `makeTextures()`.
- `window.__orbit` exposes the `Phaser.Game` instance in dev builds only (`import.meta.env.DEV`); the scene is `__orbit.scene.keys.main`.

## Verification

There is no test suite; verify in a real browser.

```sh
pnpm exec astro dev --background   # serve on :4321
pnpm check                          # type-check
pnpm build                          # must stay clean
```

Scripted checks drive headless Chrome with `puppeteer-core` (no bundled browser — point `executablePath` at installed Chrome) against the dev server, using `window.__orbit` to read scene state and force situations: press keys and assert planet velocity, pin the moon at two radii and compare angular speeds, boost the moon past escape energy and watch `danger` ramp before game over, place an asteroid on the planet and assert game over, synthesize touch events for the joystick. Run at 1280×800 and 390×844 (`hasTouch: true`). Re-run the acceptance bar in Tuning guide after any `CONFIG` change.
