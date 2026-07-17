import Phaser from "phaser";

// ── Tuning ────────────────────────────────────────────────────────────────
// Every gameplay number lives here. Lengths are fractions of u, speeds u/s,
// accelerations u/s² — where u = min(viewport width, height) in px — so phone
// and desktop feel the same. Edit, save, and the dev server hot-reloads.
// docs/orbit.md ("Tuning guide") explains what each knob does to the feel.
const CONFIG = {
  planet: {
    radius: 0.03, // ×u
    thrust: 0.3, // ×u/s² at full input — balance against moon.period (see docs)
    damping: 1.0, // 1/s velocity decay; terminal speed = thrust / damping
  },
  moon: {
    radius: 0.012, // ×u
    orbitRadius: 0.18, // ×u — starting circular orbit radius
    period: 6, // s per starting orbit; sets GM, so binding strength too
    softening: 2, // ×planet.radius — gravity softening; higher = gentler close flybys
  },
  escape: {
    // The gray ring is the loss line: the moon crossing ring.radius ends the
    // run. Its alpha fades in from fadeStart to fadeEnd (both ×orbitRadius).
    ring: { radius: 2.5, fadeStart: 1.4, fadeEnd: 2.2 },
    assistZone: [0.5, 0.95], // danger range where the recovery assist acts
    assistStrength: 0.55, // 1/s peak bleed of moon velocity toward the planet's
  },
  asteroids: {
    radius: [0.008, 0.02] as const, // ×u, spawn range
    speed: [0.12, 0.3] as const, // ×u/s at t=0 → t=rampTime
    interval: [2.5, 0.35] as const, // s between spawns at t=0 → t=rampTime
    targeting: [0.2, 0.6] as const, // fraction of spawns aimed at the planet, t=0 → t=rampTime
    rampTime: 90, // s of survival until full difficulty
    max: 40, // live asteroid cap
  },
};

// Palette: the site's zinc/amber Tailwind colors.
const BG = 0x18181b; // zinc-900
const AMBER = 0xfcd34d; // amber-300
const WHITE = 0xfafafa; // zinc-50
const GRAY = 0x71717a; // zinc-500
const RED = 0xef4444; // red-500

const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function lerpColor(a: number, b: number, t: number): number {
  const ca = Phaser.Display.Color.IntegerToColor(a);
  const cb = Phaser.Display.Color.IntegerToColor(b);
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(ca, cb, 1, t);
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
}

// zinc -> amber -> red as the moon nears escape.
const dangerColor = (d: number) => (d < 0.5 ? lerpColor(GRAY, AMBER, d * 2) : lerpColor(AMBER, RED, (d - 0.5) * 2));

interface Asteroid {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  r: number;
}

type Mode = "menu" | "tutorial" | "run" | "over";

class GameScene extends Phaser.Scene {
  // Everything size- or speed-like derives from u = min(width, height) so
  // phone and desktop feel the same. Re-derived on resize.
  u = 0;
  planetR = 0;
  moonR = 0;
  orbitR0 = 0;
  GM = 0;
  thrust = 0;
  E0 = 0; // specific orbital energy of the starting circular orbit (negative)

  mode: Mode = "menu";
  elapsed = 0;
  danger = 0; // smoothed 0..1, 1 = at the loss line (energy or distance)
  ringA = 0; // smoothed 0..1 visibility of the limit ring
  spawnT = 0;
  trailT = 0;

  planet!: Phaser.GameObjects.Image;
  moon!: Phaser.GameObjects.Image;
  pv = new Phaser.Math.Vector2(); // planet velocity
  mv = new Phaser.Math.Vector2(); // moon velocity
  asteroids: Asteroid[] = [];
  trail: { x: number; y: number }[] = [];

  trailGfx!: Phaser.GameObjects.Graphics;
  joyGfx!: Phaser.GameObjects.Graphics;
  exhaust!: Phaser.GameObjects.Particles.ParticleEmitter;
  boom!: Phaser.GameObjects.Particles.ParticleEmitter;
  scoreText!: Phaser.GameObjects.Text;
  hintText!: Phaser.GameObjects.Text;

  // Menu overlay (mode "menu" only).
  menuUi: Phaser.GameObjects.Container | null = null;
  tutorialBtn: Phaser.GameObjects.Text | null = null;

  // Tutorial state (mode "tutorial" only).
  tutStep = 0;
  tutStepAt = 0; // time.now when the current caption appeared (enforces min dwell)
  tutMoveT = 0;
  tutRespawning = false;
  tutCaption: Phaser.GameObjects.Text | null = null;
  tutSkip: Phaser.GameObjects.Text | null = null;

  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  joyId: number | null = null;
  joyBase = new Phaser.Math.Vector2();
  joyVec = new Phaser.Math.Vector2(); // -1..1 thrust input from the joystick

  restarting = false; // a fadeRestart is in flight

  // Dev-only diagnostics (guarded by import.meta.env.DEV, tree-shaken in prod):
  // per-frame ring buffer, moon-burst console dumps, backtick debug HUD.
  debugLog: Record<string, number | string>[] = [];
  debugHud: Phaser.GameObjects.Text | null = null;
  lastMoonSpeed = 0;
  lastBurstAt = 0;

  constructor() {
    super("main");
  }

  create(data: { mode?: Mode } = {}) {
    this.mode = data.mode === "run" ? "run" : "menu";
    this.elapsed = 0;
    this.danger = 0;
    this.ringA = 0;
    this.spawnT = CONFIG.asteroids.interval[0]; // opening grace: no rock in the first seconds
    this.trailT = 0;
    this.asteroids = [];
    this.trail = [];
    this.joyId = null;
    this.joyVec.set(0, 0);
    this.pv.set(0, 0);
    this.menuUi = null;
    this.tutorialBtn = null;
    this.tutCaption = null;
    this.tutSkip = null;
    this.restarting = false;

    this.makeTextures();
    this.deriveConstants();
    const { width: w, height: h } = this.scale;

    this.trailGfx = this.add.graphics().setDepth(1);
    this.exhaust = this.add.particles(0, 0, "disc", {
      lifespan: 350,
      speed: { min: this.u * 0.03, max: this.u * 0.08 },
      scale: { start: this.planetR / 64 / 2.2, end: 0 },
      alpha: { start: 0.7, end: 0 },
      tint: AMBER,
      emitting: false,
    });
    this.exhaust.setDepth(2);
    this.planet = this.add
      .image(w / 2, h / 2, "disc")
      .setTint(AMBER)
      .setDepth(3);
    this.moon = this.add.image(0, 0, "disc").setTint(WHITE).setDepth(4);
    this.boom = this.add.particles(0, 0, "disc", {
      lifespan: 650,
      speed: { min: this.u * 0.08, max: this.u * 0.3 },
      scale: { start: this.planetR / 64 / 2.5, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [AMBER, WHITE, GRAY],
      emitting: false,
    });
    this.boom.setDepth(5);
    this.joyGfx = this.add.graphics().setDepth(11);

    // Moon starts on a circular orbit around the planet.
    this.moon.setPosition(this.planet.x + this.orbitR0, this.planet.y);
    this.mv.set(0, -Math.sqrt(this.GM / this.orbitR0));
    this.applySizes();

    this.scoreText = this.add.text(0, 0, "0", { fontFamily: MONO, color: "#fafafa" }).setOrigin(0.5, 0).setDepth(10);
    this.hintText = this.add
      .text(0, 0, "wasd / arrows — or drag — to move", { fontFamily: MONO, color: "#71717a" })
      .setOrigin(0.5, 1)
      .setDepth(10);
    const inRun = this.mode === "run";
    this.scoreText.setVisible(inRun);
    this.hintText.setVisible(inRun);
    this.layoutHud();
    if (this.mode === "menu") this.buildMenu();

    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,LEFT,DOWN,RIGHT,R,SPACE,ENTER") as GameScene["keys"];
    this.input.keyboard!.on("keydown", () => {
      if (this.mode === "menu") this.beginRun();
    });

    // One scene-level pointer handler routes menu/tutorial taps and the
    // floating joystick (appears where the pointer lands, drag = thrust).
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.mode === "menu") {
        if (this.hitText(this.tutorialBtn, p)) return this.beginTutorial();
        this.beginRun(); // fall through: the same press seeds the joystick below
      } else if (this.mode === "tutorial" && this.hitText(this.tutSkip, p)) {
        return this.fadeRestart();
      } else if (this.mode === "over") {
        return;
      }
      if (this.joyId !== null) return;
      this.joyId = p.id;
      this.joyBase.set(p.x, p.y);
      this.joyVec.set(0, 0);
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (p.id !== this.joyId) return;
      this.joyVec.set(p.x - this.joyBase.x, p.y - this.joyBase.y).scale(1 / (this.u * 0.07));
      if (this.joyVec.length() > 1) this.joyVec.normalize();
    });
    const joyEnd = (p: Phaser.Input.Pointer) => {
      if (p.id !== this.joyId) return;
      this.joyId = null;
      this.joyVec.set(0, 0);
    };
    this.input.on("pointerup", joyEnd);
    this.input.on("pointerupoutside", joyEnd);

    // ScaleManager outlives scene restarts — detach on shutdown or handlers pile up.
    const onResize = () => this.handleResize();
    this.scale.on("resize", onResize);
    this.events.once("shutdown", () => this.scale.off("resize", onResize));

    if (this.mode === "run") this.cameras.main.fadeIn(400, 24, 24, 27);
    if (import.meta.env.DEV) {
      this.debugLog = [];
      this.debugHud = null;
      this.lastMoonSpeed = this.mv.length();
      this.input.keyboard!.on("keydown-BACKTICK", () => this.toggleDebugHud());
    }
  }

  // Fade to the background color, then restart straight into a run — used for
  // every hard cut (tutorial end, skip, game-over restart). Menu -> play stays
  // instant on purpose.
  fadeRestart() {
    if (this.restarting) return;
    this.restarting = true;
    this.cameras.main.fadeOut(300, 24, 24, 27);
    this.cameras.main.once("camerafadeoutcomplete", () => this.scene.restart({ mode: "run" }));
  }

  hitText(t: Phaser.GameObjects.Text | null, p: Phaser.Input.Pointer): boolean {
    return t !== null && t.getBounds().contains(p.x, p.y);
  }

  // ── Menu ──────────────────────────────────────────────────────────────

  buildMenu() {
    const { width: w, height: h } = this.scale;
    const px = Math.max(16, Math.round(this.u * 0.032));
    this.menuUi = this.add.container(0, 0).setDepth(20);
    this.menuUi.add(
      this.add
        .text(w / 2, h / 2 - this.u * 0.32, "orbit", { fontFamily: MONO, fontSize: px * 2.6, color: "#fafafa" })
        .setOrigin(0.5),
    );
    const prompt = this.add
      .text(w / 2, h / 2 + this.u * 0.3, "tap or press any key to play", {
        fontFamily: MONO,
        fontSize: px * 0.8,
        color: "#a1a1aa",
      })
      .setOrigin(0.5);
    this.menuUi.add(prompt);
    if (!REDUCED_MOTION) {
      this.tweens.add({ targets: prompt, alpha: 0.4, duration: 900, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    }
    this.tutorialBtn = this.add
      .text(w / 2, h / 2 + this.u * 0.39, "tutorial", { fontFamily: MONO, fontSize: px * 0.8, color: "#fcd34d" })
      .setOrigin(0.5)
      .setPadding(18, 12, 18, 12) // enlarges the tap target; text stays centered
      .setInteractive({ useHandCursor: true }); // cursor only — routing happens in the scene pointer handler
    this.menuUi.add(this.tutorialBtn);
  }

  destroyMenu() {
    if (!this.menuUi) return;
    this.tweens.killAll(); // menu mode has no other tweens; drops the prompt pulse
    this.menuUi.destroy(true);
    this.menuUi = null;
    this.tutorialBtn = null;
  }

  // Menu -> run happens in place (no restart): the idle sim is already a valid
  // start state, and the pointer that dismissed the menu can keep acting as
  // the joystick. Every other entry into a run goes through scene.restart().
  beginRun() {
    this.destroyMenu();
    this.mode = "run";
    this.elapsed = 0;
    this.scoreText.setVisible(true);
    this.hintText.setVisible(true);
  }

  // ── Tutorial ──────────────────────────────────────────────────────────

  beginTutorial() {
    this.destroyMenu();
    this.mode = "tutorial";
    this.tutMoveT = 0;
    this.tutRespawning = false;
    this.tutCaption = this.add
      .text(0, 0, "", { fontFamily: MONO, color: "#fafafa", align: "center" })
      .setOrigin(0.5, 0)
      .setDepth(20);
    this.tutSkip = this.add
      .text(0, 0, "skip tutorial →", { fontFamily: MONO, color: "#71717a" })
      .setOrigin(0.5, 1)
      .setPadding(18, 12, 18, 12)
      .setInteractive({ useHandCursor: true })
      .setDepth(20);
    this.layoutHud();
    this.tutAdvance(1, "move with wasd / arrows — or drag anywhere");
  }

  tutAdvance(step: number, caption: string) {
    this.tutStep = step;
    this.tutStepAt = this.time.now;
    this.setCaption(caption);
  }

  setCaption(text: string) {
    this.tutCaption?.setText(text).setAlpha(0);
    if (this.tutCaption) this.tweens.add({ targets: this.tutCaption, alpha: 1, duration: 300 });
  }

  tutTick(dt: number, input: Phaser.Math.Vector2) {
    if (this.time.now - this.tutStepAt < 1500) return; // every caption gets read before its gate can pass
    if (this.tutStep === 1) {
      if (input.length() > 0.2) this.tutMoveT += dt;
      if (this.tutMoveT > 0.7) this.tutAdvance(2, "now burn hard in one direction —\npush the trail to red.");
    } else if (this.tutStep === 2) {
      if (this.danger > 0.6)
        this.tutAdvance(
          3,
          "good. ease off — let your moon settle.\nthe gray ring is the limit: cross it in a real run and it's gone.",
        );
    } else if (this.tutStep === 3) {
      if (this.danger < 0.35) {
        this.tutAdvance(4, "incoming asteroid — dodge it.\nif one touches you or your moon, the run ends.");
        this.tutSpawnAsteroid();
      }
    } else if (this.tutStep === 4) {
      // Dodged = the rock is clearly past and receding (culling takes too long).
      const a = this.asteroids[0];
      const dodged =
        a &&
        Math.hypot(a.img.x - this.planet.x, a.img.y - this.planet.y) > 0.3 * this.u &&
        (this.planet.x - a.img.x) * a.vx + (this.planet.y - a.img.y) * a.vy < 0;
      if ((this.asteroids.length === 0 || dodged) && !this.tutRespawning) {
        this.tutAdvance(5, "you're ready.");
        this.time.delayedCall(1100, () => this.fadeRestart());
      }
    }
  }

  tutSpawnAsteroid() {
    // From 0.55u out toward the nearest screen edge, aimed at the planet, at
    // 1.5x the base speed — same gentle arrival (~3 s) every run.
    const { width: w, height: h } = this.scale;
    const { x: px, y: py } = this.planet;
    const d = Math.min(px, w - px, py, h - py);
    const dir =
      d === px ? { x: -1, y: 0 } : d === w - px ? { x: 1, y: 0 } : d === py ? { x: 0, y: -1 } : { x: 0, y: 1 };
    this.spawnAsteroid(
      CONFIG.asteroids.speed[0] * 1.5 * this.u,
      { x: px, y: py },
      { x: px + dir.x * 0.55 * this.u, y: py + dir.y * 0.55 * this.u },
    );
  }

  tutHit(a: Asteroid, index: number) {
    this.boom.explode(26, a.img.x, a.img.y);
    if (!REDUCED_MOTION) this.cameras.main.shake(200, 0.008);
    a.img.destroy();
    this.asteroids.splice(index, 1);
    this.tutRespawning = true;
    this.setCaption("that would've ended the run.\nhere comes another — dodge it.");
    this.time.delayedCall(1200, () => {
      if (this.mode !== "tutorial") return;
      this.tutRespawning = false;
      this.tutSpawnAsteroid();
    });
  }

  // ── World setup ───────────────────────────────────────────────────────

  makeTextures() {
    if (this.textures.exists("disc")) return;
    const g = this.add.graphics();
    g.fillStyle(0xffffff);
    g.fillCircle(64, 64, 64);
    g.generateTexture("disc", 128, 128);
    g.clear();
    // Irregular polygon "rock" — white, tinted per asteroid.
    g.fillStyle(0xffffff);
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = 64 * lerp(0.68, 1, Math.random());
      pts.push({ x: 64 + Math.cos(a) * r, y: 64 + Math.sin(a) * r });
    }
    g.fillPoints(pts, true);
    g.generateTexture("rock", 128, 128);
    g.destroy();
  }

  deriveConstants() {
    const { width: w, height: h } = this.scale;
    this.u = Math.min(w, h);
    this.planetR = CONFIG.planet.radius * this.u;
    this.moonR = CONFIG.moon.radius * this.u;
    this.orbitR0 = CONFIG.moon.orbitRadius * this.u;
    // GM follows from the configured circular-orbit period at orbitR0.
    this.GM = ((2 * Math.PI * this.orbitR0) / CONFIG.moon.period) ** 2 * this.orbitR0;
    this.thrust = CONFIG.planet.thrust * this.u;
    this.E0 = -this.GM / (2 * this.orbitR0);
  }

  applySizes() {
    this.planet.setDisplaySize(this.planetR * 2, this.planetR * 2);
    this.moon.setDisplaySize(this.moonR * 2, this.moonR * 2);
    for (const a of this.asteroids) a.img.setDisplaySize(a.r * 2, a.r * 2);
  }

  layoutHud() {
    const { width: w, height: h } = this.scale;
    const px = Math.max(16, Math.round(this.u * 0.032));
    this.scoreText.setFontSize(px).setPosition(w / 2, Math.max(16, this.u * 0.03));
    this.hintText.setFontSize(Math.max(12, Math.round(px * 0.55))).setPosition(w / 2, h - Math.max(16, this.u * 0.03));
    this.tutCaption
      ?.setFontSize(Math.max(13, Math.round(px * 0.7)))
      .setWordWrapWidth(w * 0.9)
      .setPosition(w / 2, Math.max(16, this.u * 0.04));
    this.tutSkip?.setFontSize(Math.max(12, Math.round(px * 0.55))).setPosition(w / 2, h - Math.max(10, this.u * 0.02));
  }

  handleResize() {
    const { width: w, height: h } = this.scale;
    if (w === 0 || h === 0) return;
    const uOld = this.u;
    this.deriveConstants();
    const s = this.u / uOld;
    // Lengths are ×u and speeds ×u/s, so rescaling the moon's offset and both
    // velocities keeps r/orbitR0 and E/E0 unchanged — a resize (mobile URL
    // bar) is no longer a physics discontinuity.
    this.pv.scale(s);
    this.mv.scale(s);
    this.moon.setPosition(
      this.planet.x + (this.moon.x - this.planet.x) * s,
      this.planet.y + (this.moon.y - this.planet.y) * s,
    );
    for (const a of this.asteroids) {
      a.r *= s;
      a.vx *= s;
      a.vy *= s;
    }
    this.applySizes();
    this.layoutHud();
    if (this.mode === "menu") {
      this.destroyMenu();
      this.buildMenu();
    }
    this.planet.x = Phaser.Math.Clamp(this.planet.x, this.planetR, w - this.planetR);
    this.planet.y = Phaser.Math.Clamp(this.planet.y, this.planetR, h - this.planetR);
  }

  inputVector(): Phaser.Math.Vector2 {
    const k = this.keys;
    const v = new Phaser.Math.Vector2(
      (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0),
      (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0),
    );
    v.add(this.joyVec);
    if (v.length() > 1) v.normalize();
    return v;
  }

  // ── Frame loop ────────────────────────────────────────────────────────

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs, 50) / 1000;
    if (this.mode === "over") return;
    const playerControlled = this.mode === "run" || this.mode === "tutorial";
    if (this.mode === "run") {
      this.elapsed += dt;
      this.scoreText.setText(`${Math.floor(this.elapsed)}`);
    }

    const { width: w, height: h } = this.scale;
    const input = playerControlled ? this.inputVector() : new Phaser.Math.Vector2();
    if (this.mode === "run" && this.hintText.alpha === 1 && input.length() > 0) {
      this.tweens.add({ targets: this.hintText, alpha: 0, duration: 400 });
    }

    // --- Planet: thrust + momentum, mild damping, hard walls.
    this.pv.x += input.x * this.thrust * dt;
    this.pv.y += input.y * this.thrust * dt;
    const damp = Math.exp(-CONFIG.planet.damping * dt);
    this.pv.scale(damp);
    this.planet.x += this.pv.x * dt;
    this.planet.y += this.pv.y * dt;
    if (this.planet.x < this.planetR || this.planet.x > w - this.planetR) {
      this.planet.x = Phaser.Math.Clamp(this.planet.x, this.planetR, w - this.planetR);
      if (Math.abs(this.pv.x) > this.u * 0.1) this.squash(true);
      this.pv.x = 0;
    }
    if (this.planet.y < this.planetR || this.planet.y > h - this.planetR) {
      this.planet.y = Phaser.Math.Clamp(this.planet.y, this.planetR, h - this.planetR);
      if (Math.abs(this.pv.y) > this.u * 0.1) this.squash(false);
      this.pv.y = 0;
    }
    if (input.length() > 0.1) {
      const n = input.clone().normalize();
      this.exhaust.emitParticleAt(this.planet.x - n.x * this.planetR, this.planet.y - n.y * this.planetR, 1);
    }

    // --- Moon: inverse-square gravity, semi-implicit Euler (v before p), substepped.
    // Softening caps close-pass acceleration (no slingshot flings, no numeric blow-up).
    const eps2 = (CONFIG.moon.softening * this.planetR) ** 2;
    const steps = 4;
    const hdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const dx = this.moon.x - this.planet.x;
      const dy = this.moon.y - this.planet.y;
      const r2 = dx * dx + dy * dy + eps2;
      const invR3 = 1 / (r2 * Math.sqrt(r2));
      this.mv.x += -this.GM * dx * invR3 * hdt;
      this.mv.y += -this.GM * dy * invR3 * hdt;
      this.moon.x += this.mv.x * hdt;
      this.moon.y += this.mv.y * hdt;
    }

    // --- Escape telegraph. Two signals, and the color shows the worse one:
    // energy (leading indicator — high relative speed reads as danger before
    // the moon strays) and distance to the ring (the actual loss line, so the
    // trail is guaranteed red exactly when the moon reaches it).
    const ring = CONFIG.escape.ring;
    const rdx = this.moon.x - this.planet.x;
    const rdy = this.moon.y - this.planet.y;
    const r = Math.hypot(rdx, rdy);
    const relV2 = (this.mv.x - this.pv.x) ** 2 + (this.mv.y - this.pv.y) ** 2;
    const E = relV2 / 2 - this.GM / r;
    const energyDanger = clamp01(1 - E / this.E0); // E0 (bound) -> 0, E=0 (escape energy) -> 1
    const distDanger = clamp01((r / this.orbitR0 - ring.fadeStart) / (ring.radius - ring.fadeStart));
    const target = Math.max(energyDanger, distDanger);
    this.danger += (target - this.danger) * Math.min(1, dt * 10);
    // ponytail: gravity alone is conservative — every thrust pulse pumps orbital
    // energy and it never relaxes, so E random-walks to escape and the game is
    // unplayable. Mid-danger-zone only, bleed the moon's velocity toward the
    // planet's so grazes recover; the assist fades out near the red line, so a
    // sustained burn punches through and escape stays reachable.
    const [zoneLo, zoneHi] = CONFIG.escape.assistZone;
    let assist = 0;
    if (this.mode === "tutorial") {
      // Tutorial can't be failed: the assist stays on past the red line, always
      // reels the moon back in, and floors low enough (0.25) that step 2's
      // "recover below 0.35 danger" completes on its own once you ease off.
      if (target > 0.25) assist = 1.2 * CONFIG.escape.assistStrength * ((target - 0.25) / 0.75);
    } else if (energyDanger > zoneLo && energyDanger < zoneHi) {
      // Keyed to energy only: a moon being dragged out at matched velocity has
      // low energy danger, so nothing fights the drift toward the loss ring.
      assist = CONFIG.escape.assistStrength * Math.sin(Math.PI * ((energyDanger - zoneLo) / (zoneHi - zoneLo)));
    }
    if (assist > 0) {
      const f = 1 - Math.exp(-assist * dt);
      this.mv.x += (this.pv.x - this.mv.x) * f;
      this.mv.y += (this.pv.y - this.mv.y) * f;
    }
    // Loss line: the moon crossing the ring ends the run. One rule, and it is
    // exactly the circle the player can see.
    if (this.mode === "run" && r > ring.radius * this.orbitR0) return this.gameOver("your moon drifted too far");

    // --- Moon trail (escape telegraph #1: zinc -> amber -> red).
    this.trailT += dt;
    if (this.trailT > 0.025) {
      this.trailT = 0;
      this.trail.push({ x: this.moon.x, y: this.moon.y });
      if (this.trail.length > 40) this.trail.shift();
    }
    this.trailGfx.clear();
    // --- Limit ring (escape telegraph #2): fades in as the moon strays far.
    const ringTarget = clamp01((r / this.orbitR0 - ring.fadeStart) / (ring.fadeEnd - ring.fadeStart));
    this.ringA += (ringTarget - this.ringA) * Math.min(1, dt * 8);
    if (this.ringA > 0.02) {
      this.trailGfx.lineStyle(Math.max(1.5, this.moonR * 0.15), GRAY, 0.35 * this.ringA);
      this.trailGfx.strokeCircle(this.planet.x, this.planet.y, ring.radius * this.orbitR0);
    }
    const col = dangerColor(this.danger);
    for (let i = 1; i < this.trail.length; i++) {
      this.trailGfx.lineStyle(this.moonR * 0.8 * (i / this.trail.length), col, 0.6 * (i / this.trail.length));
      this.trailGfx.lineBetween(this.trail[i - 1].x, this.trail[i - 1].y, this.trail[i].x, this.trail[i].y);
    }
    this.moon.setTint(this.danger > 0.5 ? col : WHITE);

    // --- Asteroids: ramping spawns (run only), straight drift, circle-circle collisions.
    const ast = CONFIG.asteroids;
    if (this.mode === "run") {
      const ramp = clamp01(this.elapsed / ast.rampTime);
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.asteroids.length < ast.max) {
        this.spawnT = lerp(ast.interval[0], ast.interval[1], ramp);
        // Anti-camping: a ramping fraction of rocks aims at the planet itself,
        // jittered so it reads as bad luck rather than homing.
        const jitter = () => (Math.random() - 0.5) * 0.12 * this.u;
        const aim =
          Math.random() < lerp(ast.targeting[0], ast.targeting[1], ramp)
            ? { x: this.planet.x + jitter(), y: this.planet.y + jitter() }
            : undefined;
        this.spawnAsteroid(lerp(ast.speed[0], ast.speed[1], ramp) * this.u * lerp(0.75, 1.25, Math.random()), aim);
      }
    }
    const cull = 0.12 * this.u;
    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const a = this.asteroids[i];
      a.img.x += a.vx * dt;
      a.img.y += a.vy * dt;
      a.img.rotation += dt * 0.6;
      // No culling in tutorial: its one scripted rock may legally spawn beyond
      // the margin (0.55u out), and the dodge gate — not the cull — retires it.
      if (
        this.mode !== "tutorial" &&
        (a.img.x < -cull || a.img.x > w + cull || a.img.y < -cull || a.img.y > h + cull)
      ) {
        a.img.destroy();
        this.asteroids.splice(i, 1);
        continue;
      }
      const hitPlanet = Math.hypot(a.img.x - this.planet.x, a.img.y - this.planet.y) < a.r + this.planetR;
      const hitMoon = Math.hypot(a.img.x - this.moon.x, a.img.y - this.moon.y) < a.r + this.moonR;
      if (hitPlanet || hitMoon) {
        if (this.mode === "tutorial") {
          this.tutHit(a, i);
          continue;
        }
        this.boom.explode(26, a.img.x, a.img.y);
        if (!REDUCED_MOTION) this.cameras.main.shake(250, 0.012);
        return this.gameOver("smashed by an asteroid");
      }
    }

    if (this.mode === "tutorial") this.tutTick(dt, input);

    // --- Joystick overlay.
    this.joyGfx.clear();
    if (this.joyId !== null && playerControlled) {
      const jr = this.u * 0.07;
      this.joyGfx.lineStyle(2, GRAY, 0.5).strokeCircle(this.joyBase.x, this.joyBase.y, jr);
      this.joyGfx
        .fillStyle(WHITE, 0.5)
        .fillCircle(this.joyBase.x + this.joyVec.x * jr, this.joyBase.y + this.joyVec.y * jr, jr * 0.35);
    }

    if (import.meta.env.DEV) this.debugTick(dt, r, Math.sqrt(relV2), E, assist);
  }

  // Dev-only: record the frame, dump the buffer on a moon-speed jump, feed the HUD.
  debugTick(dt: number, r: number, relV: number, E: number, assist: number) {
    const moonSpeed = this.mv.length();
    const row = {
      t: +(this.time.now / 1000).toFixed(2),
      dt: +dt.toFixed(3),
      mode: this.mode,
      rOverR0: +(r / this.orbitR0).toFixed(2),
      moonSpeed: +(moonSpeed / this.u).toFixed(3), // ×u/s
      relSpeed: +(relV / this.u).toFixed(3), // ×u/s
      EOverAbsE0: +(E / Math.abs(this.E0)).toFixed(2),
      danger: +this.danger.toFixed(2),
      assist: +assist.toFixed(2),
    };
    this.debugLog.push(row);
    if (this.debugLog.length > 90) this.debugLog.shift();
    const jump = Math.abs(moonSpeed - this.lastMoonSpeed) / this.u;
    if (jump > 0.15 && this.time.now - this.lastBurstAt > 1000) {
      this.lastBurstAt = this.time.now;
      console.warn(`[orbit] moon burst: |mv| jumped ${jump.toFixed(3)}u in one frame`, [...this.debugLog]);
    }
    this.lastMoonSpeed = moonSpeed;
    this.debugHud?.setText(
      `r/r0 ${row.rOverR0}  relV ${row.relSpeed}u/s  E/|E0| ${row.EOverAbsE0}\n` +
        `danger ${row.danger}  assist ${row.assist}  dt ${row.dt}  ${this.mode}`,
    );
  }

  toggleDebugHud() {
    if (this.debugHud) {
      this.debugHud.destroy();
      this.debugHud = null;
      return;
    }
    this.debugHud = this.add
      .text(12, Math.max(48, this.u * 0.08), "", { fontFamily: MONO, fontSize: 12, color: "#a1a1aa" })
      .setDepth(30);
  }

  spawnAsteroid(speed: number, aim?: { x: number; y: number }, from?: { x: number; y: number }) {
    const { width: w, height: h } = this.scale;
    const r = this.u * lerp(CONFIG.asteroids.radius[0], CONFIG.asteroids.radius[1], Math.random());
    const pad = r + 2;
    const [x, y] = from
      ? [from.x, from.y]
      : [
          [Math.random() * w, -pad],
          [Math.random() * w, h + pad],
          [-pad, Math.random() * h],
          [w + pad, Math.random() * h],
        ][Phaser.Math.Between(0, 3)];
    // Default aim: a random point in the central 60% of the screen — inward bias.
    const t = new Phaser.Math.Vector2(
      aim?.x ?? w * lerp(0.2, 0.8, Math.random()),
      aim?.y ?? h * lerp(0.2, 0.8, Math.random()),
    );
    const dir = t.subtract({ x, y }).normalize();
    const img = this.add
      .image(x, y, "rock")
      .setTint(0x52525b) // zinc-600: hazards sit darker than the white moon
      .setDepth(3)
      .setRotation(Math.random() * Math.PI * 2);
    img.setDisplaySize(r * 2, r * 2);
    const base = img.scaleX;
    img.setScale(0);
    this.tweens.add({ targets: img, scaleX: base, scaleY: base, duration: 250, ease: "Back.Out" });
    this.asteroids.push({ img, vx: dir.x * speed, vy: dir.y * speed, r });
  }

  squash(horizontal: boolean) {
    if (this.tweens.isTweening(this.planet)) return;
    const b = this.planet.scaleX;
    this.tweens.add({
      targets: this.planet,
      scaleX: horizontal ? b * 0.8 : b * 1.12,
      scaleY: horizontal ? b * 1.12 : b * 0.8,
      duration: 80,
      yoyo: true,
      ease: "Quad.Out",
    });
  }

  gameOver(reason: string) {
    this.mode = "over";
    this.joyId = null;
    this.joyGfx.clear();
    const { width: w, height: h } = this.scale;
    const px = Math.max(16, Math.round(this.u * 0.032));
    const ui = this.add.container(0, 0).setDepth(20).setAlpha(0);
    ui.add(this.add.rectangle(w / 2, h / 2, w, h, BG, 0.7));
    ui.add(
      this.add
        .text(w / 2, h / 2 - px * 2, `you survived ${Math.floor(this.elapsed)}s`, {
          fontFamily: MONO,
          fontSize: px * 1.5,
          color: "#fafafa",
        })
        .setOrigin(0.5),
    );
    ui.add(this.add.text(w / 2, h / 2, reason, { fontFamily: MONO, fontSize: px, color: "#a1a1aa" }).setOrigin(0.5));
    ui.add(
      this.add
        .text(w / 2, h / 2 + px * 2.5, "tap or press R to restart", {
          fontFamily: MONO,
          fontSize: px * 0.8,
          color: "#fcd34d",
        })
        .setOrigin(0.5),
    );
    this.tweens.add({ targets: ui, alpha: 1, duration: 350 });
    // Small delay so a death-frame tap doesn't skip the score screen.
    // Restart drops straight back into a run — the menu only shows on page load.
    this.time.delayedCall(400, () => {
      const restart = () => this.fadeRestart();
      this.input.once("pointerdown", restart);
      for (const e of ["keydown-R", "keydown-SPACE", "keydown-ENTER"]) this.input.keyboard!.once(e, restart);
    });
  }
}

// Boot once the self-hosted fonts are in, so canvas text renders in JetBrains Mono.
document.fonts.ready.then(() => {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: BG,
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: GameScene,
  });
  // Handle for scripted dev verification.
  if (import.meta.env.DEV) (window as unknown as { __orbit: Phaser.Game }).__orbit = game;
});
