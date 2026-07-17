# orbit

Endless-survival browser game at `/orbit`: thrust a planet around, keep its moon in orbit, dodge asteroids. Score = seconds survived (the HUD shows the bare integer). One Phaser 3.90 scene; the only page on the site that ships client-side JavaScript.

Files: `src/pages/orbit.astro` (page shell), `src/scripts/orbit.ts` (all game code).

Units: lengths are ×u, speeds ×u/s, accelerations ×u/s², where `u = min(viewport width, height)` in px — one feel across phone and desktop.

## How to play

- **Desktop:** `WASD` / arrow keys apply thrust. The planet has momentum — it drifts and decelerates, it does not stop with the key.
- **Touch:** press anywhere and drag — a floating joystick appears at the touch point; the drag vector is the thrust.
- **Start:** the page loads a start screen (idle sim + `tutorial` button). Any key or tap starts a run; tapping `tutorial` starts a nine-step interactive tutorial (see Mechanics). `skip tutorial →` jumps straight into a run.
- **Restart:** after game over, tap or press `R` / `Space` / `Enter`. Restart goes directly into a new run; the start screen appears only on page load.

A run ends three ways:

1. An asteroid touches the planet.
2. An asteroid touches the moon.
3. The moon crosses the **limit ring** — the gray circle at 2.8× the starting orbit radius, centered on the planet.

## Mechanics

**Moon.** The moon orbits under gravity with a configurable falloff — `a ∝ 1/r^n`, `n = moon.gravityFalloff` (1.5 shipped; 2 = real inverse-square) — and reacts passively to planet movement: drag the planet and the orbit deforms. `n = 1.5` flattens the force curve ~5× across the playfield (1/r² varies ~25×): less sticky up close, stronger at range, and orbits precess slowly instead of closing into ellipses. Farther is still slower: at 1.6× the starting radius the measured angular speed is 0.56× (theory: 1.6^-1.25 = 0.556).

**Danger telegraph.** One 0–1 value, `danger`, colors the moon and its trail zinc → amber (0.5) → red (1.0). It is the maximum of two signals:

- _energy danger_ — specific orbital energy `E = |v_moon − v̄_planet|²/2 − GM/((n−1)·r^(n−1))`, normalized from the starting circular orbit (`0`) to escape energy (`1`). Rises with hard burns before the moon visibly strays: the leading indicator. `v̄_planet` is the planet's velocity smoothed over ~0.5 s, and a 0.08 deadband clamps small values to 0 — raw `pv` jumps the instant the player thrusts, so unsmoothed energy flashes the moon amber on every tap (measured: a 200 ms tap reads 0.14 unsmoothed, 0 smoothed, with the moon at 1.28× orbit radius either way).
- _distance danger_ — moon distance from the planet, normalized from 1.5× orbit radius (`0`) to the limit ring (`1`). Guarantees the color is red exactly when the moon reaches the ring.

The limit ring itself fades in from 1.5× to 2.5× orbit radius and fades out when the moon returns. The ring is the loss line; the colors are the warning.

**Recovery assist.** Gravity is conservative: without help, every thrust pulse pumps orbital energy that never decays, so `danger` ratchets up and any play style eventually loses the moon (measured with the assist disabled: a held burn escaped in 0.8 s; pulsed thrust died inside 12 s). The assist bleeds the moon's velocity toward the planet's, only while _energy danger_ is inside `assistZone` [0.35, 0.95], with a sine-bump strength profile that peaks mid-zone and fades to zero at 0.95 — grazes recover, sustained burns punch through. Keying on energy danger alone matters: a moon dragged outward at matched velocity has low energy danger, so nothing fights the drift toward the limit ring. Measured with the current `CONFIG`: pulsed 400 ms burns survive indefinitely (peak danger 0.06); a continuously held burn drags the moon across the ring in ~2.7 s, with the ring visible and the color climbing for the final ~1.5 s.

**Asteroids.** Straight-line drift, no gravity. Spawn at a random point on a random screen edge. Aim: a ramping fraction (`targeting` 20% → 60%) targets the planet's position ±0.06 ×u jitter — camping one spot does not work — and the rest aim at a random point in the central 60% of the screen. Spawn interval ramps 2.5 s → 0.35 s and speed 0.12 → 0.30 ×u/s (±25% jitter) over the first 90 s of a run; live cap 40. Collision is a circle-circle distance check.

**Tutorial.** Nine steps in `tutSteps`, two kinds. Teaching captions advance on timers alone (2.8–3.5 s); action gates evaluate only after a 2.5 s dwell and require their condition met freshly after entry — a pre-met condition cannot flash a step past:

1. move, with the moon hidden (gate: 0.7 s cumulative input; the moon then pops in)
2. moon intro (timed)
3. keep-orbit hint (timed)
4. shake the moon loose (gate: the moon crosses the limit ring — losing it is the lesson, so the recovery assist stands down for this step; a 25 s timeout advances players too careful to lose it)
5. loss explanation (timed; the moon is gone)
6. warning signs — trail colors and the limit ring (timed; a fresh moon pops in)
7. dodge one asteroid (gate: asteroid fully off-screen and receding — its spawn point can sit off-screen, so "outside" alone would pass an inbound asteroid)
8. asteroid ramp warning (timed)
9. "you're ready" → fades into a run

The tutorial asteroid always spawns 0.55 ×u from the planet toward the nearest screen edge at 1.5× `asteroids.speed[0]` — same arrival every run. There is no game over: a hit explodes, shows "try again", and respawns the asteroid. Outside step 4, the moon crossing the limit ring interrupts with "you lost your moon — in a real run, that ends it", swaps in a fresh moon, and retries the step.

## Tuning guide

Every gameplay number lives in `CONFIG` at the top of `src/scripts/orbit.ts`, in the units defined in the intro. Edit, save; the dev server hot-reloads.

| Key                                 | Value         | Effect of raising it                                                                              |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `planet.radius`                     | 0.03          | Bigger target for asteroids                                                                       |
| `planet.thrust`                     | 0.3           | Snappier movement; easier to out-run the moon's gravity and lose it                               |
| `planet.damping`                    | 1.0           | Stops faster; lowers terminal speed (`thrust / damping` = 0.3 ×u/s)                               |
| `moon.radius`                       | 0.012         | Bigger target for asteroids                                                                       |
| `moon.orbitRadius`                  | 0.18          | Wider starting orbit; the limit ring scales with it                                               |
| `moon.period`                       | 6             | Calmer, slower orbit — but `GM ∝ 1/period²`, so binding weakens; retune `planet.thrust` alongside |
| `moon.softening`                    | 2             | Gentler close flybys (×`planet.radius` gravity softening); higher = weaker slingshots             |
| `moon.gravityFalloff`               | 1.5           | Force curve `a ∝ 1/r^n`; 2 = real inverse-square, lower = flatter (keep within ~1.1–2)            |
| `escape.ring.radius`                | 2.8           | More room before the moon is lost (loss line, ×`orbitRadius`)                                     |
| `escape.ring.fadeStart` / `fadeEnd` | 1.5 / 2.5     | Where the ring starts / finishes fading in (×`orbitRadius`)                                       |
| `escape.assistZone`                 | [0.35, 0.95]  | Energy-danger range where the recovery assist acts                                                |
| `escape.assistStrength`             | 0.55          | Stronger self-recovery from grazes (1/s peak bleed)                                               |
| `asteroids.speed`                   | [0.12, 0.30]  | Asteroid speed at 0 s → `rampTime` (×u/s)                                                         |
| `asteroids.interval`                | [2.5, 0.35]   | Seconds between spawns at 0 s → `rampTime`                                                        |
| `asteroids.targeting`               | [0.2, 0.6]    | Fraction of spawns aimed at the planet at 0 s → `rampTime` (anti-camping)                         |
| `asteroids.rampTime`                | 90            | Seconds of survival until full difficulty                                                         |
| `asteroids.radius`                  | [0.008, 0.02] | Asteroid size range                                                                               |
| `asteroids.max`                     | 40            | Live asteroid cap                                                                                 |

Acceptance bar after retuning (check with the headless-browser recipe in Verification):

1. Pulsed 400 ms burns survive indefinitely, peak danger ≤ 0.6.
2. A continuously held burn loses the moon in 2–8 s.
3. Terminal speed (`planet.thrust / planet.damping`) ≥ 0.8× `asteroids.speed[1]`, or late-game dodging fails.

Constants outside `CONFIG` (edit in place if needed): physics step clamp 50 ms with 4 substeps, danger smoothing 10/s, planet-velocity smoothing 2/s with a 0.08 energy-danger deadband, trail 40 points sampled every 25 ms, joystick radius 0.07 ×u, asteroid cull margin 0.12 ×u (culling is off in the tutorial), tutorial gate dwell 2.5 s, timed captions 2.8–3.5 s, shake-step timeout 25 s, tutorial asteroid distance 0.55 ×u and speed 1.5× `asteroids.speed[0]`, planet trail 40 points sampled every 25 ms (retracts when stopped), fade 300 ms out / 400 ms in, burst-dump threshold 0.15 ×u per frame.

## Architecture

- `src/pages/orbit.astro` is a standalone document, not a `Base.astro` page: the game must not scroll, has no footer, and needs `touch-action: none` on the canvas container. It loads the site fonts and `global.css`, overlays a home link, and imports `src/scripts/orbit.ts` in a client `<script>`. Page and canvas background are pure black (`#000000`) for contrast; the rest of the site stays zinc-900.
- The game boots after `document.fonts.ready` so Phaser canvas text renders in JetBrains Mono on the first frame. The game config sets `fps: { smoothStep: false }`: Phaser's delta smoothing caps deltas near the 60 fps target, which runs the whole sim at half speed on a 30 fps session — `update()` clamps raw dt at 50 ms instead.
- One scene, four modes: `menu` (idle sim + start UI), `tutorial`, `run`, `over`. Mode transitions: menu → run happens in place so the dismissing tap can seed the joystick; every other entry into a run goes through `fadeRestart()` — 300 ms camera fade-out, `scene.restart({ mode: "run" })`, 400 ms fade-in — with `create()` as the single reset path. Gotcha: Phaser's `restart()` without arguments reuses the previous start data — always pass `{ mode }` explicitly.
- Physics: `a = -GM·r̂/r^n` (`n = moon.gravityFalloff`) integrated with semi-implicit Euler — velocity before position (plain Euler spirals outward). `GM = v0² · orbitRadius^(n−1)` with `v0 = 2π·orbitRadius/period`, so the period is exact at the starting radius for any `n`; `circSpeed(r)` gives the circular speed elsewhere (tests re-pin orbits with it). Softening (`r² + ε²`, ε = `moon.softening` × planet radius) caps close-pass acceleration: no slingshot flings, no numeric blow-up when the moon is dragged through the planet.
- Sizing: `Phaser.Scale.RESIZE` fills the viewport; every constant derives from `u` per `deriveConstants()`. On resize, constants re-derive and the moon's offset, both velocities, and asteroid sizes/velocities all rescale by the u-ratio — relative physics state (`r/orbitR0`, `E/E0`) is continuous through mobile URL-bar resizes.
- Art: three runtime-generated textures, no asset files — `disc` and jittered-polygon `rock` (white, tinted per object), and `planet` (canvas: amber-500 shadow disc with an amber-300 lit circle offset 18 px toward the top-left — a crescent-shaded ball, shadow on the bottom-right). The planet draws a moon-style motion trail whenever it moves: tapered polyline of recent positions, amber, alpha ≤ 0.3, width ≤ 0.5× planet radius, retracting when stopped. Swap textures for SVGs by loading real ones and deleting `makeTextures()`.
- `window.__orbit` exposes the `Phaser.Game` instance in dev builds only (`import.meta.env.DEV`); the scene is `__orbit.scene.keys.main`.
- Dev diagnostics (also dev-only): backtick toggles a debug HUD — moon distance, relative speed, energy, combined danger with its energy/distance split, assist, dt; a 90-frame ring buffer dumps to the console via `console.warn` whenever the moon's speed jumps more than 0.15 ×u in one frame. Start here for any telegraph or physics report.

## Verification

There is no test suite; verify in a real browser.

```sh
pnpm exec astro dev --background   # serve on :4321
pnpm check                          # type-check
pnpm build                          # must stay clean
```

Scripted checks drive headless Chrome with `puppeteer-core` (no bundled browser — point `executablePath` at installed Chrome) against the dev server, using `window.__orbit` to read scene state and force situations: press keys and assert planet velocity, pin the moon at two radii and compare angular speeds, boost the moon past escape energy and watch `danger` ramp before game over, place an asteroid on the planet and assert game over, synthesize touch events for the joystick. Run at 1280×800 and 390×844 (`hasTouch: true`). Re-run the acceptance bar in Tuning guide after any `CONFIG` change.
