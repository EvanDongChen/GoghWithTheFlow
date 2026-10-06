import { Life, type View } from './anim/life';
import { clamp } from './core/math';
import { ChunkPool } from './paint/pool';
import { CW, FRAME_W, H, World } from './world/world';

type Mode = 'gallery' | 'wander';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ADJ = ['quiet', 'restless', 'golden', 'sleepless', 'drifting', 'silver', 'burning', 'dreaming', 'wandering', 'midnight', 'swirling', 'hushed', 'cobalt', 'luminous', 'windswept'];
const NOUN = ['cypress', 'village', 'comet', 'steeple', 'meadow', 'lantern', 'moon', 'orchard', 'river', 'spire', 'hill', 'olive', 'chapel', 'ember', 'tide'];

function randomSeed(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(ADJ)}-${pick(NOUN)}-${1 + Math.floor(Math.random() * 999)}`;
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pretty = (seed: string) => seed.replace(/-/g, ' ');

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

  constructor() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.renderScale = clamp((innerHeight * dpr) / H, 0.75, 1.5);

    const params = new URLSearchParams(location.search);
    if (params.get('intro') === '0') $('intro').remove();
    this.speed = Number(params.get('speed') ?? this.speed);
    this.speedInput.value = String(this.speed);
    if (params.get('animate') === '0') this.animating = false;
    this.bind();
    this.setSeed(params.get('seed') || randomSeed());
    this.setMode(params.get('mode') === 'wander' ? 'wander' : 'gallery');
    this.setPlaying(this.playing);
    this.setAnimating(this.animating);
    this.onSpeed();
    this.resize();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------ state

  private setSeed(seed: string) {
    this.pool?.dispose();
    this.world = new World(seed);
    this.pool = new ChunkPool(seed, this.renderScale, () => { this.dirty = true; });
    this.life = new Life(this.world);
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

  private syncUrl() {
    const url = new URL(location.href);
    url.searchParams.set('seed', this.world.seed);
    if (this.mode === 'wander') url.searchParams.set('mode', 'wander');
    else url.searchParams.delete('mode');
    for (const k of ['intro', 'speed', 'animate']) url.searchParams.delete(k);
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

    if (this.mode === 'wander' && !this.dragging) {
      const before = this.camX;
      this.camX += ((this.playing ? this.speed : 0) + this.vel) * dt;
      this.vel *= Math.exp(-dt * 2.5);
      if (Math.abs(this.vel) < 1) this.vel = 0;
      if (this.camX !== before) this.dirty = true;
    }

    const wanted = this.wanted();
    this.pool.request(wanted);

    const view: View = this.mode === 'gallery'
      ? { x0: 0, x1: FRAME_W, scale: this.galleryCanvas.width / FRAME_W, offsetX: 0 }
      : { x0: this.camX, x1: this.camX + this.viewW, scale: this.viewScale, offsetX: 0 };
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
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.wanderCanvas.width = Math.round(innerWidth * dpr);
    this.wanderCanvas.height = Math.round(innerHeight * dpr);
    this.dirty = true;
  }

  // ------------------------------------------------------------ actions

  private save() {
    const s = this.pool.scale, out = document.createElement('canvas');
    const x0 = this.mode === 'gallery' ? 0 : this.camX, w = this.mode === 'gallery' ? FRAME_W : this.viewW;
    out.width = Math.round(w * s);
    out.height = this.pool.chunkPy;
    const ctx = out.getContext('2d')!;
    for (let c = World.chunkOf(x0); c <= World.chunkOf(x0 + w); c++) {
      const img = this.pool.get(c)?.image;
      if (img) ctx.drawImage(img, Math.round((c * CW - x0) * s), 0);
    }
    this.life.drawStatic(ctx, { x0, x1: x0 + w, scale: s, offsetX: 0 });
    const name = `starry-night-${this.world.seed}${this.mode === 'wander' ? `-${Math.round(this.camX)}` : ''}.png`;
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.toast('Saved to your downloads');
    }, 'image/png');
  }

  private async share() {
    const url = new URL(location.href);
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
    $('btn-save').onclick = () => this.save();
    $('btn-share').onclick = () => this.share();
    $('btn-full').onclick = () => this.toggleFullscreen();
    $('btn-about').onclick = (e) => { e.stopPropagation(); this.toggleAbout(); };
    $('about-close').onclick = () => this.toggleAbout(false);
    this.animBtn.onclick = () => this.setAnimating(!this.animating);
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
    const end = () => {
      if (!this.dragging) return;
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
      else if (k === 's') this.save();
      else if (k === 'a') this.setAnimating(!this.animating);
      else if (k === 'c') this.share();
      else if (k === 'f') this.toggleFullscreen();
      else if (k === '?' || k === 'i') this.toggleAbout();
      else if (k === 'escape') this.toggleAbout(false);
      else if (k === ' ' && this.mode === 'wander') { e.preventDefault(); this.setPlaying(!this.playing); }
      else if (k === 'arrowright' || k === 'arrowleft') {
        if (this.mode === 'gallery') this.setMode('wander');
        this.vel += k === 'arrowright' ? 700 : -700;
      }
    });
  }
}

new App();
