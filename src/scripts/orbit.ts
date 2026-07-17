import Phaser from "phaser";

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

  over = false;
  elapsed = 0;
  danger = 0; // smoothed 0..1, 1 = at escape energy
  escapeT = 0;
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

  keys!: Record<
    "W" | "A" | "S" | "D" | "UP" | "LEFT" | "DOWN" | "RIGHT" | "R" | "SPACE" | "ENTER",
    Phaser.Input.Keyboard.Key
  >;
  joyId: number | null = null;
  joyBase = new Phaser.Math.Vector2();
  joyVec = new Phaser.Math.Vector2(); // -1..1 thrust input from the joystick

  constructor() {
    super("main");
  }

  create() {
    this.over = false;
    this.elapsed = 0;
    this.danger = 0;
    this.escapeT = 0;
    this.spawnT = 0;
    this.trailT = 0;
    this.asteroids = [];
    this.trail = [];
    this.joyId = null;
    this.joyVec.set(0, 0);
    this.pv.set(0, 0);

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

    this.scoreText = this.add.text(0, 0, "0s", { fontFamily: MONO, color: "#fafafa" }).setOrigin(0.5, 0).setDepth(10);
    this.hintText = this.add
      .text(0, 0, "wasd / arrows — or drag — to move", { fontFamily: MONO, color: "#71717a" })
      .setOrigin(0.5, 1)
      .setDepth(10);
    this.layoutHud();

    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,LEFT,DOWN,RIGHT,R,SPACE,ENTER") as GameScene["keys"];

    // Floating joystick: appears where the pointer lands, drag vector = thrust.
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.over || this.joyId !== null) return;
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
  }

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
    this.planetR = 0.03 * this.u;
    this.moonR = 0.012 * this.u;
    this.orbitR0 = 0.18 * this.u;
    // GM chosen so the starting circular orbit has a ~4 s period. Thrust is
    // tuned just below the moon's gravity at r0 so burst maneuvers are safe and
    // only sustained full-throttle burns outrun the moon toward escape
    // (measured: ~4 s of held thrust escapes, pulsed thrust survives).
    const T = 4;
    this.GM = ((2 * Math.PI * this.orbitR0) / T) ** 2 * this.orbitR0;
    this.thrust = 0.42 * this.u;
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
  }

  handleResize() {
    const { width: w, height: h } = this.scale;
    if (w === 0 || h === 0) return;
    // ponytail: mid-run resizes (mobile URL bar) re-derive GM etc.; the orbit's
    // energy readout shifts slightly and the trail color re-settles. Accepted.
    const scaleAsteroids = this.u;
    this.deriveConstants();
    for (const a of this.asteroids) {
      a.r *= this.u / scaleAsteroids;
      a.vx *= this.u / scaleAsteroids;
      a.vy *= this.u / scaleAsteroids;
    }
    this.applySizes();
    this.layoutHud();
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

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs, 50) / 1000;
    if (this.over) return;
    this.elapsed += dt;
    this.scoreText.setText(`${Math.floor(this.elapsed)}s`);

    const { width: w, height: h } = this.scale;
    const input = this.inputVector();
    if (this.hintText.alpha === 1 && input.length() > 0) {
      this.tweens.add({ targets: this.hintText, alpha: 0, duration: 400 });
    }

    // --- Planet: thrust + momentum, mild damping, hard walls.
    this.pv.x += input.x * this.thrust * dt;
    this.pv.y += input.y * this.thrust * dt;
    const damp = Math.exp(-1.3 * dt);
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
    const eps2 = this.planetR ** 2; // softening so a dragged-in moon can't blow up numerically
    const steps = 2;
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

    // --- Escape telegraph: specific orbital energy relative to the planet.
    const rdx = this.moon.x - this.planet.x;
    const rdy = this.moon.y - this.planet.y;
    const r = Math.hypot(rdx, rdy);
    const relV2 = (this.mv.x - this.pv.x) ** 2 + (this.mv.y - this.pv.y) ** 2;
    const E = relV2 / 2 - this.GM / r;
    const target = clamp01(1 - E / this.E0); // E0 (bound) -> 0, E=0 (escape) -> 1
    this.danger += (target - this.danger) * Math.min(1, dt * 10);
    // ponytail: gravity alone is conservative — every thrust pulse pumps orbital
    // energy and it never relaxes, so E random-walks to escape and the game is
    // unplayable. Mid-danger-zone only, bleed the moon's velocity toward the
    // planet's so grazes recover; the assist fades out near the red line, so a
    // sustained burn punches through and escape stays reachable.
    if (target > 0.5 && target < 0.95) {
      const strength = 0.55 * Math.sin(Math.PI * ((target - 0.5) / 0.45));
      const f = 1 - Math.exp(-strength * dt);
      this.mv.x += (this.pv.x - this.mv.x) * f;
      this.mv.y += (this.pv.y - this.mv.y) * f;
    }
    // E must stay past escape for a beat before it counts: the trail has long
    // gone red by then, and a grazing spike can still be reeled back in.
    this.escapeT = E >= 0 ? this.escapeT + dt : 0;
    if (this.escapeT > 0.75) return this.gameOver("your moon escaped");

    // --- Moon trail (also the escape telegraph: zinc -> amber -> red).
    this.trailT += dt;
    if (this.trailT > 0.025) {
      this.trailT = 0;
      this.trail.push({ x: this.moon.x, y: this.moon.y });
      if (this.trail.length > 40) this.trail.shift();
    }
    this.trailGfx.clear();
    const col = dangerColor(this.danger);
    for (let i = 1; i < this.trail.length; i++) {
      this.trailGfx.lineStyle(this.moonR * 0.8 * (i / this.trail.length), col, 0.6 * (i / this.trail.length));
      this.trailGfx.lineBetween(this.trail[i - 1].x, this.trail[i - 1].y, this.trail[i].x, this.trail[i].y);
    }
    this.moon.setTint(this.danger > 0.5 ? col : WHITE);

    // --- Asteroids: ramping spawns, straight drift, circle-circle collisions.
    const ramp = clamp01(this.elapsed / 90);
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.asteroids.length < 40) {
      this.spawnT = lerp(1.2, 0.35, ramp);
      this.spawnAsteroid(lerp(0.08, 0.22, ramp) * this.u * lerp(0.75, 1.25, Math.random()));
    }
    const cull = 0.12 * this.u;
    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const a = this.asteroids[i];
      a.img.x += a.vx * dt;
      a.img.y += a.vy * dt;
      a.img.rotation += dt * 0.6;
      if (a.img.x < -cull || a.img.x > w + cull || a.img.y < -cull || a.img.y > h + cull) {
        a.img.destroy();
        this.asteroids.splice(i, 1);
        continue;
      }
      const hitPlanet = Math.hypot(a.img.x - this.planet.x, a.img.y - this.planet.y) < a.r + this.planetR;
      const hitMoon = Math.hypot(a.img.x - this.moon.x, a.img.y - this.moon.y) < a.r + this.moonR;
      if (hitPlanet || hitMoon) {
        this.boom.explode(26, a.img.x, a.img.y);
        if (!REDUCED_MOTION) this.cameras.main.shake(250, 0.012);
        return this.gameOver("smashed by an asteroid");
      }
    }

    // --- Joystick overlay.
    this.joyGfx.clear();
    if (this.joyId !== null) {
      const jr = this.u * 0.07;
      this.joyGfx.lineStyle(2, GRAY, 0.5).strokeCircle(this.joyBase.x, this.joyBase.y, jr);
      this.joyGfx
        .fillStyle(WHITE, 0.5)
        .fillCircle(this.joyBase.x + this.joyVec.x * jr, this.joyBase.y + this.joyVec.y * jr, jr * 0.35);
    }
  }

  spawnAsteroid(speed: number) {
    const { width: w, height: h } = this.scale;
    const r = this.u * lerp(0.008, 0.02, Math.random());
    const edge = Phaser.Math.Between(0, 3);
    const pad = r + 2;
    let x = 0;
    let y = 0;
    if (edge === 0) [x, y] = [Math.random() * w, -pad];
    else if (edge === 1) [x, y] = [Math.random() * w, h + pad];
    else if (edge === 2) [x, y] = [-pad, Math.random() * h];
    else [x, y] = [w + pad, Math.random() * h];
    // Aim at a random point in the central 60% of the screen — inward bias.
    const t = new Phaser.Math.Vector2(w * lerp(0.2, 0.8, Math.random()), h * lerp(0.2, 0.8, Math.random()));
    const dir = t.subtract({ x, y }).normalize();
    const img = this.add
      .image(x, y, "rock")
      .setTint(0xa1a1aa)
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
    this.over = true;
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
    this.time.delayedCall(400, () => {
      this.input.once("pointerdown", () => this.scene.restart());
      this.input.keyboard!.once("keydown-R", () => this.scene.restart());
      this.input.keyboard!.once("keydown-SPACE", () => this.scene.restart());
      this.input.keyboard!.once("keydown-ENTER", () => this.scene.restart());
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
