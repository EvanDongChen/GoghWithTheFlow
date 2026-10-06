import { Life, type View } from './anim/life';
import { Music } from './audio/music';
import { clamp } from './core/math';
import { ChunkPool } from './paint/pool';
import { DESIGNS, renderPostcard, type Design, type PostcardInfo } from './postcard';
import { CW, FRAME_W, H, MOOD_NAMES, World, type Biome, type Landmark } from './world/world';

type Mode = 'gallery' | 'wander';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ADJ = ['quiet', 'restless', 'golden', 'sleepless', 'drifting', 'silver', 'burning', 'dreaming', 'wandering', 'midnight', 'swirling', 'hushed', 'cobalt', 'luminous', 'windswept'];
const NOUN = ['cypress', 'village', 'comet', 'steeple', 'meadow', 'lantern', 'moon', 'orchard', 'river', 'spire', 'hill', 'olive', 'chapel', 'ember', 'tide'];

function randomSeed(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(ADJ)}-${pick(NOUN)}-${1 + Math.floor(Math.random() * 999)}`;
}

/** A seed whose gallery moon hangs in the top right corner, as in the original. */
function classicSeed(): string {
  for (let i = 0; i < 40; i++) {
    const seed = randomSeed(), w = new World(seed);
    if (w.cornerMoon && !w.flipped) return seed;
  }
  return randomSeed();
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Phones and tablets: paint at a lower resolution and keep the page's frame budget for scrolling. */
const coarse = matchMedia('(pointer: coarse)').matches;
const pretty = (seed: string) => seed.replace(/-/g, ' ');

const REGION_NAMES: Record<Biome, string> = {
  village: 'A village under the church spire', wheat: 'Wheat fields and haystacks', river: 'A gaslit river', orchard: 'Olive orchards', mill: 'Windmill hills', sunflower: 'A field of sunflowers', stormfield: 'Wheat under a stormy sky',
};
const LANDMARK_NAMES: Record<Landmark, string> = {
  none: 'A quiet village', mill: 'A windmill on the hills', river: 'A gaslit river', haystacks: 'Haystacks in the wheat', cafe: 'A lit café terrace', sunflowers: 'Sunflowers in the foreground',
};
const PRECIP_NAMES = { rain: 'rain falling', snow: 'snow falling', petals: 'blossom on the wind', leaves: 'leaves on the wind' };
const MOON_NAMES = { crescent: 'Crescent moon', half: 'Half moon', full: 'Full moon' };

class App {
  private app = $('app');
  private wanderCanvas = $<HTMLCanvasElement>('wander-canvas');
  private wctx = this.wanderCanvas.getContext('2d')!;
  private galleryCanvas = $<HTMLCanvasElement>('gallery-canvas');
  private gctx = this.galleryCanvas.getContext('2d')!;
  private seedInput = $<HTMLInputElement>('seed-input');
  private speedInput = $<HTMLInputElement>('speed');
  private playBtn = $('btn-play');
  private animBtn = $('btn-anim');
  private soundBtn = $('btn-sound');
  private stirBtn = $('btn-stir');
  private stirring = false;
  /** The last pointer position on screen, for stir mode, and where it was on the previous frame. */
  private client: { x: number; y: number; px: number; py: number } | null = null;
  private downX = 0;
  private downY = 0;
  private music = new Music();
  private about = $('about');
  private toastEl = $('toast');

  private mode: Mode = 'gallery';
  private world!: World;
  private pool!: ChunkPool;
  private life!: Life;
  private readonly renderScale: number;

  /** Camera left edge, in world units. */
  private camX = 0;
  /** Momentum from dragging, scrolling and arrow keys, in world units per second. */
  private vel = 0;
  private playing = !reducedMotion;
  private animating = !reducedMotion;
  private speed = 45;
  private dragging = false;
  private lastX = 0;
  private lastT = 0;
  private lastFrame = 0;
  private toastTimer = 0;
  private dirty = true;
  private lastScene = 0;
  private slowFor = 0;
  private smooth = 1 / 60;

  constructor() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.renderScale = clamp((innerHeight * dpr) / H, 0.75, coarse ? 1 : 1.5);

    const params = new URLSearchParams(location.search);
    if (params.get('intro') === '0') $('intro').remove();
    this.speed = Number(params.get('speed') ?? this.speed);
    this.speedInput.value = String(this.speed);
    if (params.get('animate') === '0') this.animating = false;
    this.bind();
    this.setSeed(params.get('seed') || (this.firstVisit() ? classicSeed() : randomSeed()));
    // A shared link can point at a spot along the night.
    if (params.has('x')) this.camX = Number(params.get('x')) || 0;
    this.setMode(params.get('mode') === 'wander' ? 'wander' : 'gallery');
    this.setPlaying(this.playing);
    this.setAnimating(this.animating);
    this.setSound(false);
    try { if (localStorage.getItem('gogh-stir') === '1') this.setStirring(true); } catch { /* ignore */ }
    this.onSpeed();
    this.resize();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------ state

  /** True the first time this browser opens the site; the first night keeps the original's moon. */
  private firstVisit(): boolean {
    try {
      if (localStorage.getItem('gogh-visited')) return false;
      localStorage.setItem('gogh-visited', '1');
    } catch { /* private mode */ }
    return true;
  }

  private setSeed(seed: string) {
    this.pool?.dispose();
    this.world = new World(seed);
    this.pool = new ChunkPool(seed, this.renderScale, () => { this.dirty = true; });
    this.life = new Life(this.world);
    this.life.stir = this.stirring;
    this.life.sample = (x, y) => this.samplePaint(x, y);
    this.music.setWorld(this.world);
    this.camX = 0;
    this.vel = 0;
    this.dirty = true;

    this.galleryCanvas.width = this.pool.chunkPx * 2;
    this.galleryCanvas.height = this.pool.chunkPy;

    this.seedInput.value = seed;
    $('placard-no').textContent = pretty(seed);
    $('hud-seed').textContent = pretty(seed);
    $('stroke-count').textContent = 'Preparing the palette…';
    $('gallery-progress').style.opacity = '1';
    this.syncUrl();
  }

  private setMode(mode: Mode) {
    this.mode = mode;
    this.app.dataset.mode = mode;
    document.querySelectorAll<HTMLButtonElement>('.segmented button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    if (mode === 'wander') this.resize();
    this.dirty = true;
    this.syncUrl();
  }

  private setPlaying(on: boolean) {
    this.playing = on;
    this.playBtn.classList.toggle('paused', !on);
    this.playBtn.setAttribute('aria-label', on ? 'Pause drifting' : 'Resume drifting');
    this.playBtn.title = on ? 'Pause (Space)' : 'Drift (Space)';
  }

  private setAnimating(on: boolean) {
    this.animating = on;
    this.dirty = true;
    this.animBtn.classList.toggle('active', on);
    this.animBtn.setAttribute('aria-pressed', String(on));
    this.animBtn.title = on ? 'Still the painting (A)' : 'Bring the painting to life (A)';
  }

  private setStirring(on: boolean) {
    this.stirring = on;
    this.life.stir = on;
    if (!on) this.life.pointerOut();
    // Stirring needs the living layer.
    if (on && !this.animating) this.setAnimating(true);
    this.app.classList.toggle('stirring', on);
    this.stirBtn.classList.toggle('active', on);
    this.stirBtn.setAttribute('aria-pressed', String(on));
    this.stirBtn.title = on ? 'Stop stirring (B)' : 'Stir the painting with your cursor (B)';
    try { localStorage.setItem('gogh-stir', on ? '1' : '0'); } catch { /* private mode */ }
  }

  /** A screen point in world units, and how many world units one screen pixel spans; null if it is off the painting. */
  private toWorld(cx: number, cy: number): [number, number, number] | null {
    if (this.mode === 'gallery') {
      const r = this.galleryCanvas.getBoundingClientRect();
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
      const u = FRAME_W / r.width;
      return [(cx - r.left) * u, (cy - r.top) * u, u];
    }
    const u = this.wanderCanvas.width / innerWidth / this.viewScale;
    return [this.camX + cx * u, cy * u, u];
  }

  /** Feed the cursor to the living layer once a frame, as a velocity relative to the screen (so walking is not stirring). */
  private updateStir(dt: number) {
    const c = this.client;
    if (!this.stirring || !c || this.dragging) return;
    const w = this.toWorld(c.x, c.y);
    if (!w) { this.life.pointerOut(); c.px = c.x; c.py = c.y; return; }
    const d = Math.max(dt, 1 / 240);
    this.life.pointer(w[0], w[1], ((c.x - c.px) * w[2]) / d, ((c.y - c.py) * w[2]) / d);
    c.px = c.x;
    c.py = c.y;
  }

  /** The painted colour at a world point, read from its chunk's image. */
  private samplePaint(x: number, y: number): [number, number, number] | null {
    const c = World.chunkOf(x), img = this.pool.get(c)?.image;
    if (!img || y < 0 || y >= H) return null;
    const s = this.pool.scale, px = Math.floor((x - c * CW) * s), py = Math.floor(y * s);
    if (px < 0 || px >= img.width || py < 0 || py >= img.height) return null;
    const d = img.getContext('2d')!.getImageData(px, py, 1, 1).data;
    return d[3] ? [d[0], d[1], d[2]] : null;
  }

  private stirBurst(e: PointerEvent) {
    if (!this.stirring || Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 6) return false;
    const w = this.toWorld(e.clientX, e.clientY);
    if (!w) return false;
    this.life.burst(w[0], w[1]);
    this.music.sparkle();
    return true;
  }

  private async setSound(on: boolean) {
    try {
      await this.music.setEnabled(on);
    } catch {
      this.toast('Sound is not available here');
      on = false;
    }
    this.soundBtn.classList.toggle('active', on);
    this.soundBtn.classList.toggle('muted', !on);
    this.soundBtn.setAttribute('aria-pressed', String(on));
    this.soundBtn.title = on ? 'Mute (M)' : 'Play the soundtrack (M)';
    this.soundBtn.setAttribute('aria-label', on ? 'Mute the soundtrack' : 'Play the soundtrack');
  }

  private syncUrl() {
    const url = new URL(location.href);
    url.searchParams.set('seed', this.world.seed);
    if (this.mode === 'wander') url.searchParams.set('mode', 'wander');
    else url.searchParams.delete('mode');
    for (const k of ['intro', 'speed', 'animate', 'x']) url.searchParams.delete(k);
    history.replaceState(null, '', url);
  }

  // ------------------------------------------------------------ frame loop

  /** Canvas pixels per world unit in wander mode. */
  private get viewScale() { return this.wanderCanvas.height / H; }
  private get viewW() { return this.wanderCanvas.width / this.viewScale; }

  private visibleChunks(): number[] {
    const a = World.chunkOf(this.camX), b = World.chunkOf(this.camX + this.viewW);
    const out: number[] = [];
    for (let c = a; c <= b; c++) out.push(c);
    return out;
  }

  private wanted(): number[] {
    if (this.mode === 'gallery') return [0, 1];
    const vis = this.visibleChunks();
    const a = vis[0], b = vis[vis.length - 1];
    const forward = this.vel + (this.playing ? this.speed : 0) >= 0;
    // Paint what's on screen first, then the road ahead, then a little behind.
    return forward ? [...vis, b + 1, b + 2, a - 1] : [...vis.reverse(), a - 1, a - 2, b + 1];
  }

  private loop(t: number) {
    const dt = Math.min(0.05, (t - (this.lastFrame || t)) / 1000);
    this.lastFrame = t;

    // If frames keep taking too long, thin out the animation layer instead of letting the page stutter.
    this.smooth += (dt - this.smooth) * 0.05;
    this.slowFor = this.smooth > 0.034 ? this.slowFor + dt : 0;
    if (this.slowFor > 2.5) {
      this.life.quality = Math.max(0.3, this.life.quality * 0.7);
      this.slowFor = 0;
    }

    if (this.mode === 'wander' && !this.dragging) {
      const before = this.camX;
      this.camX += ((this.playing ? this.speed : 0) + this.vel) * dt;
      this.vel *= Math.exp(-dt * 2.5);
      if (Math.abs(this.vel) < 1) this.vel = 0;
      if (this.camX !== before) this.dirty = true;
    }

    const sceneX = this.mode === 'gallery' ? FRAME_W / 2 : this.camX + this.viewW / 2;
    if (t - this.lastScene > 400) {
      this.lastScene = t;
      this.music.setScene({ x: sceneX, mode: this.mode });
      const mood = `${MOOD_NAMES[this.world.moodAt(sceneX)]} · ${this.world.season}`, el = $('hud-mood');
      if (el.textContent !== mood) el.textContent = mood;
    }

    const wanted = this.wanted();
    this.pool.request(wanted);

    const view: View = this.mode === 'gallery'
      ? { x0: 0, x1: FRAME_W, scale: this.galleryCanvas.width / FRAME_W, offsetX: 0 }
      : { x0: this.camX, x1: this.camX + this.viewW, scale: this.viewScale, offsetX: 0 };
    this.updateStir(dt);
    if (this.animating) this.life.update(dt, view);

    if (this.dirty || this.animating) {
      if (this.mode === 'gallery') this.drawGallery(view);
      else this.drawWander(view);
      this.dirty = false;
    }

    if (this.mode === 'gallery') this.updateGalleryProgress();
    else {
      const busy = this.visibleChunks().some((c) => !this.pool.get(c)?.done);
      $('hud-painting').classList.toggle('on', busy);
      $('hud-distance').textContent = (this.camX / 1000).toFixed(2);
    }

    const keep = new Set(wanted), here = World.chunkOf(this.camX);
    this.pool.evict((c) => keep.has(c) || c === 0 || c === 1 || (this.mode === 'wander' && Math.abs(c - here) <= 4));
    this.world.prune(this.mode === 'gallery' ? 0 : here);
    requestAnimationFrame((n) => this.loop(n));
  }

  private drawGallery(view: View) {
    const g = this.gctx;
    g.fillStyle = '#16296a';
    g.fillRect(0, 0, this.galleryCanvas.width, this.galleryCanvas.height);
    for (const c of [0, 1]) {
      const img = this.pool.get(c)?.image;
      if (img) g.drawImage(img, c * this.pool.chunkPx, 0);
    }
    if (this.pool.get(0)?.done && this.pool.get(1)?.done) {
      if (this.animating) this.life.draw(g, view);
      else this.life.drawStatic(g, view);
    }
  }

  private updateGalleryProgress() {
    const a = this.pool.get(0), b = this.pool.get(1);
    const p = ((a?.progress ?? 0) + (b?.progress ?? 0)) / 2;
    const bar = $('gallery-progress');
    bar.style.width = `${(p * 100).toFixed(1)}%`;
    bar.style.opacity = p >= 1 ? '0' : '1';
    if (a?.strokes && b?.strokes) {
      const text = `${(a.strokes + b.strokes).toLocaleString()} brushstrokes`, count = $('stroke-count');
      if (count.textContent !== text) count.textContent = text;
    }
  }

  private drawWander(view: View) {
    const ctx = this.wctx, W = this.wanderCanvas.width, Hh = this.wanderCanvas.height, v = this.viewScale;
    ctx.fillStyle = '#0b1230';
    ctx.fillRect(0, 0, W, Hh);
    ctx.imageSmoothingQuality = 'medium';
    let allDone = true;
    for (const c of this.visibleChunks()) {
      const ch = this.pool.get(c);
      if (!ch?.done) allDone = false;
      if (!ch?.image) continue;
      // Snap to whole pixels and overlap by one so neighbouring chunks never show a hairline seam.
      const x = (c * CW - this.camX) * v, dx = Math.floor(x);
      ctx.drawImage(ch.image, dx, 0, Math.ceil(x + CW * v) - dx + 1, Hh);
    }
    if (allDone) {
      if (this.animating) this.life.draw(ctx, view);
      else this.life.drawStatic(ctx, view);
    }
  }

  private resize() {
    // Wander redraws the whole screen every frame, so keep its backing store modest on dense displays.
    const dpr = Math.min(devicePixelRatio || 1, coarse ? 1.25 : 1.5);
    this.wanderCanvas.width = Math.round(innerWidth * dpr);
    this.wanderCanvas.height = Math.round(innerHeight * dpr);
    this.dirty = true;
  }

  // ------------------------------------------------------------ actions

  /** The visible painting, composed from its chunks, plus where it sits in the world. */
  private compose() {
    const s = this.pool.scale, out = document.createElement('canvas');
    const x0 = this.mode === 'gallery' ? 0 : this.camX, w = this.mode === 'gallery' ? FRAME_W : this.viewW;
    out.width = Math.round(w * s);
    out.height = this.pool.chunkPy;
    const ctx = out.getContext('2d')!;
    let strokes = 0;
    for (let c = World.chunkOf(x0); c <= World.chunkOf(x0 + w); c++) {
      const ch = this.pool.get(c);
      if (ch?.image) ctx.drawImage(ch.image, Math.round((c * CW - x0) * s), 0);
      strokes += ch?.strokes ?? 0;
    }
    this.life.drawStatic(ctx, { x0, x1: x0 + w, scale: s, offsetX: 0 });
    return { out, x0, w, strokes };
  }

  private download(canvas: HTMLCanvasElement, name: string) {
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      // Phones often ignore blob downloads; hand the picture to the share sheet (Save Image, Messages...) instead.
      if (coarse) {
        const file = new File([blob], name, { type: 'image/png' });
        try {
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Gogh with the Flow' });
            return;
          }
        } catch (e) {
          if ((e as DOMException).name === 'AbortError') return;
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.toast('Saved to your downloads');
    }, 'image/png');
  }

  /** Wait (briefly) for the visible chunks to finish painting, so a print is never half-blank. */
  private async untilPainted() {
    const visible = () => (this.mode === 'gallery' ? [0, 1] : this.visibleChunks());
    if (!visible().some((c) => !this.pool.get(c)?.done)) return;
    this.toast('Still painting. One moment…');
    for (let i = 0; i < 100 && visible().some((c) => !this.pool.get(c)?.done); i++) await new Promise((r) => setTimeout(r, 200));
  }

  /** Save the plain painting, without a card. */
  private async savePlain() {
    await this.untilPainted();
    const { out, x0 } = this.compose();
    this.download(out, `starry-night-${this.world.seed}${this.mode === 'wander' ? `-${Math.round(x0)}` : ''}.png`);
  }

  // ------------------------------------------------------------ postcards

  private card: { base: Omit<PostcardInfo, 'design' | 'message'>; name: string } | null = null;
  private design: Design = 'classic';
  private previewTimer = 0;
  private previewJob = 0;

  /** Open the postcard dialog for the current view: pick a design, write a message, save. */
  private async openCard() {
    if (!$('card-dialog').hidden) return;
    await this.untilPainted();
    const { out, x0, w, strokes } = this.compose(), wander = this.mode === 'wander', wd = this.world;
    const mid = x0 + w / 2, suffix = wander ? `-${Math.round(this.camX)}` : '';
    const moon = wd.near(World.chunkOf(mid)).glows.find((g) => g.kind === 'moon');
    const precip = wd.precipAt(mid);
    const season = wd.season[0].toUpperCase() + wd.season.slice(1);
    const details: [string, string][] = [
      ['Sky', MOOD_NAMES[wd.moodAt(mid)]],
      ['Season', precip ? `${season}, ${PRECIP_NAMES[precip]}` : season],
      ['Moon', moon?.phase ? MOON_NAMES[moon.phase] : 'No moon in view'],
      [wander ? 'Country' : 'Landmark', wander ? REGION_NAMES[wd.biomeAt(mid)] : LANDMARK_NAMES[wd.landmark]],
      ['Brushstrokes', strokes ? strokes.toLocaleString() : 'Countless'],
    ];
    if (!wander && wd.flipped) details.push(['Composition', 'Mirrored']);
    this.card = {
      name: `postcard-${wd.seed}${suffix}`,
      base: {
        art: out, seed: wd.seed, title: 'The Starry Night', details,
        lines: ['After Vincent van Gogh', 'Procedural oil on canvas, 2026'],
        place: wander ? `${(mid / 1000).toFixed(2)} km into the night` : 'The gallery',
      },
    };
    this.toggleAbout(false);
    $('card-dialog').hidden = false;
    this.syncDesignButtons();
    this.queuePreview(0);
  }

  private closeCard() {
    $('card-dialog').hidden = true;
    this.card = null;
  }

  private syncDesignButtons() {
    document.querySelectorAll<HTMLButtonElement>('#card-designs button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.design === this.design)));
  }

  private currentCard(): PostcardInfo | null {
    return this.card ? { ...this.card.base, design: this.design, message: $<HTMLTextAreaElement>('card-message').value } : null;
  }

  private queuePreview(delay = 200) {
    clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(async () => {
      const info = this.currentCard();
      if (!info) return;
      const job = ++this.previewJob, card = await renderPostcard(info);
      if (job !== this.previewJob || !this.card) return;
      const pv = $<HTMLCanvasElement>('card-preview');
      pv.width = 1200;
      pv.height = 800;
      pv.getContext('2d')!.drawImage(card, 0, 0, pv.width, pv.height);
    }, delay);
  }

  private async saveCard() {
    const info = this.currentCard();
    if (!info || !this.card) return;
    const name = this.card.name;
    this.toast('Printing your postcard…');
    const card = await renderPostcard(info);
    this.download(card, `${name}-${info.design}.png`);
    try { localStorage.setItem('gogh-design', info.design); } catch { /* private mode */ }
    this.closeCard();
  }

  private async share() {
    const url = new URL(location.href);
    if (this.mode === 'wander') url.searchParams.set('x', String(Math.round(this.camX)));
    const text = `The Starry Night, No. ${pretty(this.world.seed)}`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Gogh with the Flow', text, url: url.toString() });
        return;
      }
      await navigator.clipboard.writeText(url.toString());
      this.toast('Link copied. Anyone who opens it sees this exact night.');
    } catch {
      this.toast(url.toString());
    }
  }

  private toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => this.toast('Fullscreen is not available here'));
  }

  private toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }

  private onSpeed() {
    this.speed = Number(this.speedInput.value);
    this.speedInput.style.setProperty('--fill', `${(this.speed / Number(this.speedInput.max)) * 100}%`);
  }

  private newSeed(seed = randomSeed()) {
    this.setSeed(seed);
    this.toast(`A new night: ${pretty(seed)}`);
  }

  private toggleAbout(open = this.about.hidden) {
    this.about.hidden = !open;
  }

  // ------------------------------------------------------------ input

  private bind() {
    document.querySelectorAll<HTMLButtonElement>('.segmented button').forEach((b) => {
      b.onclick = () => this.setMode(b.dataset.mode as Mode);
    });
    $('btn-new').onclick = () => this.newSeed();
    $('btn-save').onclick = () => this.openCard();
    $('card-close').onclick = () => this.closeCard();
    $('card-save').onclick = () => this.saveCard();
    $('card-plain').onclick = () => { this.closeCard(); this.savePlain(); };
    const msg = $<HTMLTextAreaElement>('card-message');
    msg.oninput = () => { $('card-count').textContent = String(140 - msg.value.length); this.queuePreview(); };
    msg.onkeydown = (e) => { if (e.key === 'Escape') this.closeCard(); e.stopPropagation(); };
    const designs = $('card-designs');
    for (const d of DESIGNS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.design = d.id;
      b.textContent = d.name;
      b.setAttribute('role', 'radio');
      b.onclick = () => { this.design = d.id; this.syncDesignButtons(); this.queuePreview(40); };
      designs.append(b);
    }
    try { const saved = localStorage.getItem('gogh-design') as Design | null; if (saved && DESIGNS.some((d) => d.id === saved)) this.design = saved; } catch { /* ignore */ }
    $('btn-share').onclick = () => this.share();
    $('btn-full').onclick = () => this.toggleFullscreen();
    $('btn-about').onclick = (e) => { e.stopPropagation(); this.toggleAbout(); };
    $('about-close').onclick = () => this.toggleAbout(false);
    this.animBtn.onclick = () => this.setAnimating(!this.animating);
    this.stirBtn.onclick = () => this.setStirring(!this.stirring);
    addEventListener('pointermove', (e) => {
      if (!this.stirring) return;
      if (this.client) { this.client.x = e.clientX; this.client.y = e.clientY; }
      else this.client = { x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY };
    });
    addEventListener('pointerdown', (e) => { this.downX = e.clientX; this.downY = e.clientY; }, true);
    const leave = () => { this.client = null; this.life.pointerOut(); };
    document.addEventListener('pointerleave', leave);
    addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') leave(); });
    this.soundBtn.onclick = () => this.setSound(!this.music.on);
    this.playBtn.onclick = () => this.setPlaying(!this.playing);
    this.speedInput.oninput = () => this.onSpeed();
    this.seedInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        this.newSeed(this.seedInput.value.trim().toLowerCase().replace(/\s+/g, '-') || randomSeed());
        this.seedInput.blur();
      }
      e.stopPropagation();
    };
    document.addEventListener('click', (e) => {
      if (!this.about.hidden && !this.about.contains(e.target as Node)) this.toggleAbout(false);
    });
    addEventListener('resize', () => this.resize());

    // A swipe across the gallery steps into the painting and keeps walking.
    const gallery = document.querySelector<HTMLElement>('.gallery')!;
    let sx = 0, sy = 0, st = 0;
    gallery.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = performance.now(); });
    gallery.addEventListener('pointerup', (e) => {
      if (this.stirBurst(e)) return;
      // While stirring, a drag across the painting stirs it rather than stepping inside.
      if (this.stirring) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (this.mode !== 'gallery' || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      this.setMode('wander');
      this.vel = clamp((-dx / Math.max(0.12, (performance.now() - st) / 1000)) * 0.6, -1500, 1500);
    });

    const c = this.wanderCanvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.vel = 0;
      this.lastX = e.clientX;
      this.lastT = performance.now();
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const now = performance.now(), dpr = this.wanderCanvas.width / innerWidth;
      const dx = ((e.clientX - this.lastX) * dpr) / this.viewScale;
      this.camX -= dx;
      this.dirty = true;
      const dt = Math.max(1, now - this.lastT) / 1000;
      this.vel = clamp(-dx / dt, -4000, 4000) * 0.6 + this.vel * 0.4;
      this.lastX = e.clientX;
      this.lastT = now;
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.stirBurst(e);
      this.dragging = false;
      c.classList.remove('dragging');
      if (performance.now() - this.lastT > 80) this.vel = 0;
      this.vel -= this.playing ? this.speed : 0;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dpr = this.wanderCanvas.width / innerWidth;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.camX += (d * dpr) / this.viewScale;
      this.dirty = true;
    }, { passive: false });

    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'g') this.setMode('gallery');
      else if (k === 'w') this.setMode('wander');
      else if (k === 'n') this.newSeed();
      else if (k === 's') { if (e.shiftKey) this.savePlain(); else this.openCard(); }
      else if (k === 'm') this.setSound(!this.music.on);
      else if (k === 'a') this.setAnimating(!this.animating);
      else if (k === 'b') this.setStirring(!this.stirring);
      else if (k === 'c') this.share();
      else if (k === 'f') this.toggleFullscreen();
      else if (k === '?' || k === 'i') this.toggleAbout();
      else if (k === 'escape') { this.toggleAbout(false); this.closeCard(); }
      else if (k === ' ' && this.mode === 'wander') { e.preventDefault(); this.setPlaying(!this.playing); }
      else if (k === 'arrowright' || k === 'arrowleft') {
        if (this.mode === 'gallery') this.setMode('wander');
        this.vel += k === 'arrowright' ? 700 : -700;
      }
    });
  }
}

new App();
