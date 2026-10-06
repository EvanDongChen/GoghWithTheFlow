// Renders the painting as a postcard in one of several designs, with the same details the gallery
// placard gives, a stamp, a postmark and an optional handwritten message.

export type Design = 'classic' | 'museum' | 'airmail' | 'polaroid';

export const DESIGNS: { id: Design; name: string }[] = [
  { id: 'classic', name: 'Classic' },
  { id: 'museum', name: 'Museum' },
  { id: 'airmail', name: 'Airmail' },
  { id: 'polaroid', name: 'Polaroid' },
];

export interface PostcardInfo {
  /** The painting, already composed (chunks plus the static life layer). */
  art: HTMLCanvasElement;
  seed: string;
  title: string;
  /** Short lines under the title, e.g. "Procedural oil on canvas, 2026". */
  lines: string[];
  /** Label/value pairs for the details list. */
  details: [string, string][];
  /** Where the view sits: "The gallery" or "2.40 km into the night". */
  place: string;
  design: Design;
  /** What the sender wants to say, in their own hand. */
  message: string;
}

const W = 2400, H = 1600, M = 90;
const SERIF = '"Cormorant Garamond", Georgia, serif', SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';
const HAND = '"Caveat", "Segoe Script", "Bradley Hand", cursive';

interface Theme {
  bg: string; ink: string; dim: string; accent: string; rule: string; hand: string;
  /** The card behind the print: a border colour, and whether it is a dark card. */
  dark: boolean;
}

const THEMES: Record<Design, Theme> = {
  classic: { bg: '#f3ead2', ink: '#2e2618', dim: '#7a6d55', accent: '#b8861f', rule: 'rgba(122,109,85,0.5)', hand: '#27407a', dark: false },
  museum: { bg: '#0c1226', ink: '#f3ead2', dim: '#a9a28c', accent: '#e9c46a', rule: 'rgba(233,196,106,0.45)', hand: '#f3dfa0', dark: true },
  airmail: { bg: '#f7f3e8', ink: '#1f2a44', dim: '#69708a', accent: '#c8372d', rule: 'rgba(31,42,68,0.4)', hand: '#1f3d8a', dark: false },
  polaroid: { bg: '#d8ccb2', ink: '#2c2518', dim: '#6f6450', accent: '#a8501f', rule: 'rgba(60,48,30,0.4)', hand: '#2a2f55', dark: false },
};

export async function renderPostcard(info: PostcardInfo): Promise<HTMLCanvasElement> {
  // Make sure the page's fonts are ready before drawing text with them.
  try {
    await Promise.all([
      document.fonts.load(`italic 600 80px ${SERIF}`), document.fonts.load(`500 40px ${SERIF}`), document.fonts.load(`500 28px ${SANS}`),
      document.fonts.load(`600 60px ${HAND}`),
    ]);
  } catch { /* fall back to system fonts */ }

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!, th = THEMES[info.design];
  const rnd = mulberry(hashStr(info.seed));

  paper(g, th, info.design, rnd);

  // The print: a box on the left, with the painting fitted inside it.
  const boxW = 1480, boxH = H - 2 * M - 40;
  const art = placePrint(g, info, th, M, boxW, boxH);

  // Right-hand side.
  const rx = M + boxW + 70, rw = W - M - rx;
  g.textBaseline = 'alphabetic';
  stamp(g, W - M - 210, M - 10, 210, 250, info.seed, rnd, th);
  postmark(g, W - M - 450, M - 20, info.place, th);

  g.fillStyle = th.dim;
  g.font = `500 28px ${SANS}`;
  spaced(g, 'GREETINGS FROM', rx, 400, 6);
  g.fillStyle = info.design === 'airmail' ? th.accent : th.ink;
  g.font = `italic 600 112px ${SERIF}`;
  const titleLines = wrap(g, info.title, rw);
  titleLines.forEach((l, i) => g.fillText(l, rx, 510 + i * 108));
  let y = 510 + (titleLines.length - 1) * 108 + 70;

  g.font = `500 54px ${SERIF}`;
  g.fillStyle = th.ink;
  for (const l of wrap(g, `No. ${info.seed.replace(/-/g, ' ')}`, rw)) { g.fillText(l, rx, y); y += 58; }
  y += 6;
  g.fillStyle = th.accent;
  g.fillRect(rx, y, 120, 4);
  y += 62;

  g.fillStyle = th.dim;
  g.font = `italic 500 36px ${SERIF}`;
  for (const l of info.lines) { g.fillText(l, rx, y); y += 46; }
  y += 30;

  // Details, in two columns when the list is long so the message keeps its room.
  const cols = info.details.length > 4 ? 2 : 1, colW = rw / cols;
  const startY = y;
  let rowEnd = y;
  info.details.forEach(([k, v], i) => {
    const col = i % cols, row = Math.floor(i / cols), x = rx + col * colW;
    let yy = startY + row * (cols === 2 ? 124 : 108);
    g.fillStyle = th.dim;
    g.font = `500 22px ${SANS}`;
    spaced(g, k.toUpperCase(), x, yy, 3);
    g.fillStyle = th.ink;
    g.font = `500 ${cols === 2 ? 34 : 38}px ${SERIF}`;
    const lines = wrap(g, v, colW - 20);
    lines.slice(0, 2).forEach((l, j) => g.fillText(l, x, yy + 40 + j * 38));
    yy += 40 + Math.min(2, lines.length) * 38;
    rowEnd = Math.max(rowEnd, yy);
  });

  // The message, written on ruled lines at the foot of the card.
  g.strokeStyle = th.rule;
  g.lineWidth = 2;
  const lineH = 66, nLines = 3, ay = H - M - 70 - (nLines - 1) * lineH;
  for (let i = 0; i < nLines; i++) {
    g.beginPath();
    g.moveTo(rx, ay + i * lineH + 12);
    g.lineTo(rx + rw, ay + i * lineH + 12);
    g.stroke();
  }
  if (info.message.trim()) {
    g.fillStyle = th.hand;
    let size = 58;
    let lines: string[] = [];
    // Shrink the writing until it fits on the lines.
    for (; size >= 36; size -= 4) {
      g.font = `600 ${size}px ${HAND}`;
      lines = wrap(g, info.message.trim().replace(/\s+/g, ' '), rw - 10);
      if (lines.length <= nLines) break;
    }
    lines.slice(0, nLines).forEach((l, i) => {
      g.save();
      g.translate(rx + 6, ay + i * lineH + 4);
      g.rotate(-0.012 + i * 0.004);
      g.fillText(l, 0, 0);
      g.restore();
    });
  } else {
    g.fillStyle = th.dim;
    g.font = `italic 500 30px ${SERIF}`;
    g.fillText('gogh with the flow · every night is its own', rx, H - M + 4);
  }
  void art;
  return cv;
}

// ------------------------------------------------------------ the card and the print

/** The card stock behind everything, with its border. */
function paper(g: CanvasRenderingContext2D, th: Theme, design: Design, rnd: () => number) {
  if (design === 'museum') {
    const bg = g.createRadialGradient(W * 0.35, H * 0.45, 100, W * 0.5, H * 0.5, W * 0.75);
    bg.addColorStop(0, '#1a2244');
    bg.addColorStop(1, th.bg);
    g.fillStyle = bg;
  } else g.fillStyle = th.bg;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${th.dark ? '200,200,255' : rnd() < 0.5 ? '120,100,60' : '255,255,255'},${rnd() * (th.dark ? 0.03 : 0.07)})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
  if (design === 'airmail') {
    // The red and blue striped border of an airmail envelope.
    const t = 26;
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    g.rect(t, t, W - 2 * t, H - 2 * t);
    g.clip('evenodd');
    for (let x = -H; x < W + H; x += 70) {
      g.fillStyle = (Math.round(x / 70) & 1) ? '#c8372d' : '#2c4f9e';
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 40, 0);
      g.lineTo(x + 40 - H, H);
      g.lineTo(x - H, H);
      g.closePath();
      g.fill();
    }
    g.restore();
  } else if (design === 'museum') {
    g.strokeStyle = th.accent;
    g.lineWidth = 4;
    g.strokeRect(30, 30, W - 60, H - 60);
    g.lineWidth = 1.5;
    g.strokeRect(46, 46, W - 92, H - 92);
  } else if (design === 'polaroid') {
    // A little tape on the corners of a linen table.
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 2;
    for (let i = 0; i < 40; i++) { g.beginPath(); g.moveTo(0, i * 42); g.lineTo(W, i * 42); g.stroke(); }
  } else {
    g.strokeStyle = 'rgba(122,109,85,0.35)';
    g.lineWidth = 3;
    g.strokeRect(34, 34, W - 68, H - 68);
  }
}

/** Draws the painting in its mount and returns the rectangle it occupies. */
function placePrint(g: CanvasRenderingContext2D, info: PostcardInfo, th: Theme, M: number, boxW: number, boxH: number) {
  const design = info.design, ratio = info.art.width / info.art.height;
  const border = design === 'polaroid' ? 38 : design === 'museum' ? 34 : 26;
  const bottom = design === 'polaroid' ? 150 : border;
  let pw = boxW - 2 * border - (design === 'polaroid' ? 60 : 0), ph = pw / ratio;
  const maxH = boxH - border - bottom - (design === 'polaroid' ? 40 : 0);
  if (ph > maxH) { ph = maxH; pw = ph * ratio; }
  const cx = M + boxW / 2, cy = H / 2;
  const frameW = pw + 2 * border, frameH = ph + border + bottom;

  g.save();
  g.translate(cx, cy);
  if (design === 'polaroid') g.rotate(-0.035);
  const fx = -frameW / 2, fy = -frameH / 2;
  g.shadowColor = th.dark ? 'rgba(0,0,0,0.6)' : 'rgba(40,28,10,0.38)';
  g.shadowBlur = 40;
  g.shadowOffsetY = 14;
  if (design === 'museum') {
    // A gilded frame with a cream mount.
    const gold = g.createLinearGradient(fx, fy, fx + frameW, fy + frameH);
    gold.addColorStop(0, '#f1d98c');
    gold.addColorStop(0.5, '#a97a2a');
    gold.addColorStop(1, '#e6c36a');
    g.fillStyle = gold;
    g.fillRect(fx, fy, frameW, frameH);
    g.shadowColor = 'transparent';
    g.fillStyle = '#ece3c8';
    g.fillRect(fx + 14, fy + 14, frameW - 28, frameH - 28);
    g.strokeStyle = 'rgba(80,56,18,0.55)';
    g.lineWidth = 3;
    g.strokeRect(fx + 6, fy + 6, frameW - 12, frameH - 12);
  } else {
    g.fillStyle = '#fbf8ee';
    g.fillRect(fx, fy, frameW, frameH);
  }
  g.shadowColor = 'transparent';
  const ax = fx + border, ay = fy + border;
  g.drawImage(info.art, ax, ay, pw, ph);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  g.strokeRect(ax, ay, pw, ph);

  if (design === 'polaroid') {
    // The caption, written under the photograph.
    g.fillStyle = th.hand;
    g.font = `600 64px ${HAND}`;
    g.textAlign = 'center';
    g.fillText(`${info.title.replace(/^The /, '')}, no. ${info.seed.replace(/-/g, ' ')}`.slice(0, 44), 0, fy + frameH - 62);
    g.textAlign = 'left';
    // Two strips of tape.
    for (const sx of [-1, 1]) {
      g.save();
      g.translate(sx * (frameW / 2 - 50), fy + 6);
      g.rotate(sx * 0.7);
      g.fillStyle = 'rgba(236,222,170,0.72)';
      g.fillRect(-70, -22, 140, 44);
      g.restore();
    }
  }
  g.restore();
  return { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph };
}

// ------------------------------------------------------------ small pieces

function stamp(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: string, rnd: () => number, th: Theme) {
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.rotate(0.04);
  g.translate(-w / 2, -h / 2);
  // Perforated edge: the paper is knocked out in a ring of small circles.
  g.fillStyle = '#fbf8ee';
  g.shadowColor = 'rgba(0,0,0,0.3)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 3;
  g.fillRect(0, 0, w, h);
  g.shadowColor = 'transparent';
  g.fillStyle = th.bg;
  const r = 7;
  for (let i = r; i < w; i += r * 2.4) { g.beginPath(); g.arc(i, 0, r, 0, 7); g.arc(i, h, r, 0, 7); g.fill(); }
  for (let j = r; j < h; j += r * 2.4) { g.beginPath(); g.arc(0, j, r, 0, 7); g.arc(w, j, r, 0, 7); g.fill(); }
  // A tiny starry night.
  const ix = 20, iy = 20, iw = w - 40, ih = h - 40;
  const sky = g.createLinearGradient(0, iy, 0, iy + ih);
  sky.addColorStop(0, '#16296a');
  sky.addColorStop(1, '#4f7ab8');
  g.fillStyle = sky;
  g.fillRect(ix, iy, iw, ih);
  g.lineCap = 'round';
  for (let k = 0; k < 26; k++) {
    const yy = iy + 8 + k * (ih / 30);
    g.strokeStyle = k % 3 ? '#7aa5dc' : '#d4e2ea';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(ix + 6, yy + Math.sin(k) * 4);
    g.bezierCurveTo(ix + iw * 0.3, yy - 18, ix + iw * 0.6, yy + 18, ix + iw - 6, yy - 6);
    g.stroke();
  }
  g.fillStyle = '#f6df6e';
  g.beginPath();
  g.arc(ix + iw * 0.7, iy + ih * 0.25, 20, 0, 7);
  g.fill();
  g.fillStyle = '#16296a';
  g.beginPath();
  g.arc(ix + iw * 0.7 + 8, iy + ih * 0.25 - 5, 17, 0, 7);
  g.fill();
  g.fillStyle = '#0f1a14';
  g.beginPath();
  g.moveTo(ix, iy + ih);
  g.quadraticCurveTo(ix + iw * 0.18, iy + ih * 0.35 + rnd() * 20, ix + iw * 0.34, iy + ih);
  g.fill();
  g.fillStyle = '#fbf8ee';
  g.font = `italic 600 24px ${SERIF}`;
  g.textAlign = 'right';
  g.fillText('Nº ' + (hashStr(seed) % 900 + 100), ix + iw - 8, iy + ih - 10);
  g.restore();
  g.textAlign = 'left';
}

function postmark(g: CanvasRenderingContext2D, x: number, y: number, place: string, th: Theme) {
  const ink = th.dark ? 'rgba(233,196,106,0.7)' : 'rgba(70,52,30,0.58)';
  g.save();
  g.translate(x, y);
  g.rotate(-0.12);
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineWidth = 4;
  g.beginPath();
  g.arc(110, 110, 104, 0, 7);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.arc(110, 110, 88, 0, 7);
  g.stroke();
  g.textAlign = 'center';
  g.font = `600 22px ${SANS}`;
  g.fillText('STARRY NIGHT', 110, 78);
  g.font = `500 17px ${SANS}`;
  const lines = wrap(g, place.toUpperCase(), 150);
  lines.slice(0, 3).forEach((l, i) => g.fillText(l, 110, 118 + i * 24));
  g.font = `600 20px ${SANS}`;
  g.fillText(String(new Date().getFullYear()), 110, 184);
  // Wavy cancel lines running off to the left.
  g.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    for (let t = 0; t <= 1; t += 0.05) {
      const xx = 20 - t * 230, yy = 60 + i * 30 + Math.sin(t * 14 + i) * 7;
      if (t === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
    }
    g.stroke();
  }
  g.restore();
  g.textAlign = 'left';
}

/** Draw letter-spaced text (canvas letterSpacing is not available everywhere). */
function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, gap: number) {
  for (const ch of text) { g.fillText(ch, x, y); x += g.measureText(ch).width + gap; }
}

function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(' '), lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && g.measureText(next).width > width) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
