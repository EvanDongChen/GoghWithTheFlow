// Renders the painting as a postcard: the canvas in a white-bordered print on cream card stock,
// with the same details the gallery placard gives, a stamp and a postmark.

export interface PostcardInfo {
  /** The painting, already composed (chunks plus the static life layer). */
  art: HTMLCanvasElement;
  seed: string;
  title: string;
  /** Short lines under the title, e.g. "Procedural oil on canvas, 2026". */
  lines: string[];
  /** Label/value pairs for the details list. */
  details: [string, string][];
  /** Where the view sits: "Gallery" or "2.40 km into the night". */
  place: string;
}

const W = 2400, H = 1600, M = 90;
const CREAM = '#f3ead2', INK = '#2e2618', DIM = '#7a6d55', GOLD = '#b8862f';
const SERIF = '"Cormorant Garamond", Georgia, serif', SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';

export async function renderPostcard(info: PostcardInfo): Promise<HTMLCanvasElement> {
  // Make sure the page's fonts are ready before drawing text with them.
  try {
    await Promise.all([
      document.fonts.load(`italic 600 80px ${SERIF}`), document.fonts.load(`500 40px ${SERIF}`), document.fonts.load(`500 28px ${SANS}`),
    ]);
  } catch { /* fall back to system fonts */ }

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;

  // Card stock, with a little tooth.
  g.fillStyle = CREAM;
  g.fillRect(0, 0, W, H);
  const rnd = mulberry(hashStr(info.seed));
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '120,100,60' : '255,255,255'},${rnd() * 0.07})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
  // A faint inner rule, like a printed border.
  g.strokeStyle = 'rgba(122,109,85,0.35)';
  g.lineWidth = 3;
  g.strokeRect(34, 34, W - 68, H - 68);

  // The print: fits a box on the left, with a white border and a soft shadow.
  const boxW = 1480, boxH = H - 2 * M - 40, border = 26;
  const ratio = info.art.width / info.art.height;
  let pw = boxW - 2 * border, ph = pw / ratio;
  if (ph > boxH - 2 * border) { ph = boxH - 2 * border; pw = ph * ratio; }
  const px = M + (boxW - pw - 2 * border) / 2 + border, py = (H - ph) / 2;
  g.save();
  g.shadowColor = 'rgba(40,28,10,0.38)';
  g.shadowBlur = 40;
  g.shadowOffsetY = 14;
  g.fillStyle = '#fbf8ee';
  g.fillRect(px - border, py - border, pw + 2 * border, ph + 2 * border);
  g.restore();
  g.drawImage(info.art, px, py, pw, ph);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  g.strokeRect(px, py, pw, ph);

  // Right-hand side.
  const rx = M + boxW + 70, rw = W - M - rx;
  g.textBaseline = 'alphabetic';

  // Stamp and postmark, top right.
  stamp(g, W - M - 210, M - 10, 210, 250, info.seed, rnd);
  postmark(g, W - M - 450, M - 20, info.place);

  // Title block.
  g.fillStyle = DIM;
  g.font = `500 28px ${SANS}`;
  spaced(g, 'GREETINGS FROM', rx, 400, 6);
  g.fillStyle = INK;
  g.font = `italic 600 112px ${SERIF}`;
  const titleLines = wrap(g, info.title, rw);
  titleLines.forEach((l, i) => g.fillText(l, rx, 510 + i * 108));
  let y = 510 + (titleLines.length - 1) * 108 + 70;

  g.font = `500 54px ${SERIF}`;
  g.fillStyle = INK;
  for (const l of wrap(g, `No. ${info.seed.replace(/-/g, ' ')}`, rw)) { g.fillText(l, rx, y); y += 58; }
  y += 6;
  g.fillStyle = GOLD;
  g.fillRect(rx, y, 120, 4);
  y += 62;

  g.fillStyle = DIM;
  g.font = `italic 500 36px ${SERIF}`;
  for (const l of info.lines) { g.fillText(l, rx, y); y += 46; }
  y += 30;

  // Details.
  for (const [k, v] of info.details) {
    g.fillStyle = DIM;
    g.font = `500 22px ${SANS}`;
    spaced(g, k.toUpperCase(), rx, y, 3);
    g.fillStyle = INK;
    g.font = `500 38px ${SERIF}`;
    const lines = wrap(g, v, rw);
    lines.forEach((l, i) => g.fillText(l, rx, y + 40 + i * 42));
    y += 40 + lines.length * 42 + 34;
  }

  // Address lines at the foot, as on the back of a card.
  g.strokeStyle = 'rgba(122,109,85,0.5)';
  g.lineWidth = 2;
  const ay = H - M - 100;
  for (let i = 0; i < 2; i++) {
    g.beginPath();
    g.moveTo(rx, ay + i * 62);
    g.lineTo(rx + rw, ay + i * 62);
    g.stroke();
  }
  g.fillStyle = DIM;
  g.font = `italic 500 30px ${SERIF}`;
  g.fillText('gogh with the flow · every night is its own', rx, H - M + 4);
  return cv;
}

// ------------------------------------------------------------ pieces

function stamp(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: string, rnd: () => number) {
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.rotate(0.04);
  g.translate(-w / 2, -h / 2);
  // Perforated edge: the paper is knocked out in a ring of small circles.
  g.fillStyle = '#fbf8ee';
  g.shadowColor = 'rgba(40,28,10,0.3)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 3;
  g.fillRect(0, 0, w, h);
  g.shadowColor = 'transparent';
  g.fillStyle = CREAM;
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

function postmark(g: CanvasRenderingContext2D, x: number, y: number, place: string) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.12);
  g.strokeStyle = 'rgba(70,52,30,0.55)';
  g.fillStyle = 'rgba(70,52,30,0.6)';
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
