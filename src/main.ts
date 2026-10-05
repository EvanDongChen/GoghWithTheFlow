import './styles.css';
import { clamp } from './core/math';
import { ChunkPainter } from './paint/chunks';
import { CW, H, World } from './world/world';

type Mode = 'gallery' | 'wander';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ADJ = ['quiet', 'restless', 'golden', 'sleepless', 'drifting', 'silver', 'burning', 'dreaming', 'wandering', 'midnight', 'swirling', 'hushed', 'cobalt', 'luminous', 'windswept'];
const NOUN = ['cypress', 'village', 'comet', 'steeple', 'meadow', 'lantern', 'moon', 'orchard', 'river', 'spire', 'hill', 'olive', 'chapel', 'ember', 'tide'];

function randomSeed(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(ADJ)}-${pick(NOUN)}-${1 + Math.floor(Math.random() * 999)}`;
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

class App {
  private app = $('app');
  private wanderCanvas = $<HTMLCanvasElement>('wander-canvas');
  private wctx = this.wanderCanvas.getContext('2d')!;
  private galleryCanvas = $<HTMLCanvasElement>('gallery-canvas');
  private gctx = this.galleryCanvas.getContext('2d')!;
  private seedInput = $<HTMLInputElement>('seed-input');
  private speedInput = $<HTMLInputElement>('speed');
  private playBtn = $('btn-play');
  private help = $('help');
  private toastEl = $('toast');

  private mode: Mode = 'gallery';
  private world!: World;
  private painter!: ChunkPainter;
  private readonly renderScale: number;

  /** Camera left edge, in world units. */
  private camX = 0;
  /** Momentum from dragging, scrolling and arrow keys, in world units per second. */
  private vel = 0;
  private playing = !reducedMotion;
  private speed = 45;
  private dragging = false;
  private lastX = 0;
  private lastT = 0;
  private lastFrame = 0;
  private toastTimer = 0;
  private strokeCountShown = false;

  constructor() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.renderScale = clamp((innerHeight * dpr) / H, 0.75, 1.5);

    const params = new URLSearchParams(location.search);
    if (params.get('intro') === '0') $('intro').remove();
    this.speed = Number(params.get('speed') ?? this.speed);
    this.speedInput.value = String(this.speed);
    this.bind();
    this.setSeed(params.get('seed') || randomSeed());
    this.setMode(params.get('mode') === 'wander' ? 'wander' : 'gallery');
    this.setPlaying(this.playing);
    this.onSpeed();
    this.resize();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------ state

  private setSeed(seed: string) {
    this.painter?.dispose();
    this.world = new World(seed);
    this.painter = new ChunkPainter(this.world, this.renderScale);
    this.camX = 0;
    this.vel = 0;
    this.strokeCountShown = false;

    this.galleryCanvas.width = this.painter.chunkPx * 2;
    this.galleryCanvas.height = Math.round(H * this.painter.scale);
    this.gctx.clearRect(0, 0, this.galleryCanvas.width, this.galleryCanvas.height);

    this.seedInput.value = seed;
    $('placard-no').textContent = seed.replace(/-/g, ' ');
    $('hud-seed').textContent = seed.replace(/-/g, ' ');
    $('stroke-count').textContent = 'Preparing the palette…';
    $('gallery-progress').style.opacity = '1';
    this.syncUrl();
  }

  private setMode(mode: Mode) {
    this.mode = mode;
    this.app.dataset.mode = mode;
    document.querySelectorAll<HTMLButtonElement>('.segmented button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    if (mode === 'wander') this.resize();
    this.syncUrl();
  }

  private setPlaying(on: boolean) {
    this.playing = on;
    this.playBtn.classList.toggle('paused', !on);
    this.playBtn.setAttribute('aria-label', on ? 'Pause drifting' : 'Resume drifting');
    this.playBtn.title = on ? 'Pause (Space)' : 'Drift (Space)';
  }

  private syncUrl() {
    const url = new URL(location.href);
    url.searchParams.set('seed', this.world.seed);
    if (this.mode === 'wander') url.searchParams.set('mode', 'wander');
    else url.searchParams.delete('mode');
    history.replaceState(null, '', url);
  }

  // ------------------------------------------------------------ frame loop

  /** World units per wander-canvas pixel. */
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
      this.camX += ((this.playing ? this.speed : 0) + this.vel) * dt;
      this.vel *= Math.exp(-dt * 2.5);
      if (Math.abs(this.vel) < 1) this.vel = 0;
    }

    const wanted = this.wanted();
    const changed = this.painter.work(wanted, 10);

    if (this.mode === 'gallery') {
      if (changed) this.drawGallery();
      this.updateGalleryProgress();
    } else {
      this.drawWander();
      const busy = this.visibleChunks().some((c) => !this.painter.peek(c)?.done);
      $('hud-painting').classList.toggle('on', busy);
      $('hud-distance').textContent = (this.camX / 1000).toFixed(2);
    }

    this.painter.evict(16);
    this.world.prune(World.chunkOf(this.mode === 'gallery' ? 0 : this.camX));
    requestAnimationFrame((n) => this.loop(n));
  }

  private drawGallery() {
    const g = this.gctx;
    g.clearRect(0, 0, this.galleryCanvas.width, this.galleryCanvas.height);
    for (const c of [0, 1]) {
      const ch = this.painter.peek(c);
      if (ch?.started) g.drawImage(ch.canvas, c * this.painter.chunkPx, 0);
    }
  }

  private updateGalleryProgress() {
    const a = this.painter.peek(0), b = this.painter.peek(1);
    const p = ((a?.progress ?? 0) + (b?.progress ?? 0)) / 2;
    const bar = $('gallery-progress');
    bar.style.width = `${(p * 100).toFixed(1)}%`;
    if (p >= 1) bar.style.opacity = '0';
    if (!this.strokeCountShown && a?.ops && b?.ops) {
      this.strokeCountShown = true;
      $('stroke-count').textContent = `${(a.ops.length + b.ops.length).toLocaleString()} brushstrokes`;
    }
  }

  private drawWander() {
    const ctx = this.wctx, W = this.wanderCanvas.width, Hh = this.wanderCanvas.height, v = this.viewScale;
    ctx.fillStyle = '#0b1230';
    ctx.fillRect(0, 0, W, Hh);
    ctx.imageSmoothingQuality = 'high';
    for (const c of this.visibleChunks()) {
      const ch = this.painter.peek(c);
      if (!ch?.started) continue;
      // Snap to whole pixels and overlap by one so neighbouring chunks never show a hairline seam.
      const x = (c * CW - this.camX) * v, dx = Math.floor(x);
      ctx.drawImage(ch.canvas, dx, 0, Math.ceil(x + CW * v) - dx + 1, Hh);
    }
  }

  private resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.wanderCanvas.width = Math.round(innerWidth * dpr);
    this.wanderCanvas.height = Math.round(innerHeight * dpr);
  }

  // ------------------------------------------------------------ actions

  private save() {
    let out: HTMLCanvasElement;
    if (this.mode === 'gallery') {
      out = this.galleryCanvas;
    } else {
      const s = this.painter.scale;
      out = document.createElement('canvas');
      out.width = Math.round(this.viewW * s);
      out.height = Math.round(H * s);
      const ctx = out.getContext('2d')!;
      for (const c of this.visibleChunks()) {
        const ch = this.painter.peek(c);
        if (ch?.started) ctx.drawImage(ch.canvas, Math.round((c * CW - this.camX) * s), 0);
      }
    }
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

  private toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => this.toast('Fullscreen is not available here'));
  }

  private toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  private onSpeed() {
    this.speed = Number(this.speedInput.value);
    const pct = (this.speed / Number(this.speedInput.max)) * 100;
    this.speedInput.style.setProperty('--fill', `${pct}%`);
  }

  private newSeed(seed = randomSeed()) {
    this.setSeed(seed);
    this.toast(`A new night: ${seed.replace(/-/g, ' ')}`);
  }

  // ------------------------------------------------------------ input

  private bind() {
    document.querySelectorAll<HTMLButtonElement>('.segmented button').forEach((b) => {
      b.onclick = () => this.setMode(b.dataset.mode as Mode);
    });
    $('btn-new').onclick = () => this.newSeed();
    $('btn-save').onclick = () => this.save();
    $('btn-full').onclick = () => this.toggleFullscreen();
    $('btn-help').onclick = (e) => { e.stopPropagation(); this.help.hidden = !this.help.hidden; };
    this.playBtn.onclick = () => this.setPlaying(!this.playing);
    this.speedInput.oninput = () => this.onSpeed();
    this.seedInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        this.newSeed(this.seedInput.value.trim() || randomSeed());
        this.seedInput.blur();
      }
      e.stopPropagation();
    };
    document.addEventListener('click', (e) => {
      if (!this.help.hidden && !this.help.contains(e.target as Node)) this.help.hidden = true;
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
      const now = performance.now(), dpr = Math.min(devicePixelRatio || 1, 2);
      const dx = ((e.clientX - this.lastX) * dpr) / this.viewScale;
      this.camX -= dx;
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
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.camX += (d * dpr) / this.viewScale;
    }, { passive: false });

    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'g') this.setMode('gallery');
      else if (k === 'w') this.setMode('wander');
      else if (k === 'n') this.newSeed();
      else if (k === 's') this.save();
      else if (k === 'f') this.toggleFullscreen();
      else if (k === '?' || k === 'h') this.help.hidden = !this.help.hidden;
      else if (k === 'escape') this.help.hidden = true;
      else if (k === ' ' && this.mode === 'wander') { e.preventDefault(); this.setPlaying(!this.playing); }
      else if (k === 'arrowright' || k === 'arrowleft') {
        if (this.mode === 'gallery') this.setMode('wander');
        this.vel += k === 'arrowright' ? 700 : -700;
      }
    });
  }
}

new App();
