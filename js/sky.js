// The night sky: a flow field of swirls, a wavy "milky way" ribbon, haloed stars and a crescent moon.
(function (G) {
  'use strict';
  var C = G.Color, M = G.math, B = G.Brush;
  var TAU = Math.PI * 2;

  var P = C.palette({
    deep: ['#152a63', '#1b3577', '#22408a', '#1a2f6e'],
    mid: ['#2f58a0', '#3a66ad', '#4673b8', '#3560a6'],
    light: ['#6e98cc', '#86abd6', '#9fbedd', '#7aa3c9'],
    pale: ['#c4d8e0', '#dce6dc', '#b2cbd9', '#e8edd2'],
    teal: ['#5f95a6', '#7aaaa8', '#4e86a0'],
    dark: ['#101f4a', '#14275a', '#0e1c44'],
    yellow: ['#f4d24a', '#f6df6e', '#eec23a'],
    cream: ['#fbf1b8', '#fff8d8', '#f6eaa0'],
    leaf: ['#cbd88a', '#b9cf8c', '#dfe39a'],
    orange: ['#e99a2c', '#f0ae3c', '#dd8a25']
  });

  var STAR_RINGS = ['cream', 'yellow', 'cream', 'leaf', 'yellow', 'pale', 'light', 'leaf', 'light', 'pale', 'light'];
  var MOON_RINGS = ['yellow', 'orange', 'yellow', 'cream', 'orange', 'yellow', 'leaf', 'cream', 'light', 'pale', 'light', 'light'];

  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

  var Sky = {};

  Sky.setup = function (s) {
    var r = s.rng, W = s.W, H = s.H;

    var mr = H * r.range(0.034, 0.044);
    s.moon = {
      x: W * r.range(0.8, 0.9), y: H * r.range(0.1, 0.16),
      core: mr, halo: mr * r.range(2.2, 2.6), ringW: mr * 0.3,
      dir: 1, rings: MOON_RINGS, isMoon: true,
      // the crescent is the part of the disk outside this offset circle
      cut: { dx: mr * r.range(0.35, 0.5), dy: -mr * r.range(0.15, 0.35), r: mr * 0.86 }
    };

    // The great swirl: two counter-rotating vortices side by side form an S-shaped wave.
    var cx = W * r.range(0.38, 0.52), cy = H * r.range(0.27, 0.34), R = H * r.range(0.12, 0.145);
    s.vortices = [
      { x: cx - R * 0.95, y: cy + R * 0.08, R: R, dir: 1 },
      { x: cx + R * 0.95, y: cy - R * 0.1, R: R * 0.85, dir: -1 }
    ];
    var extra = r.int(0, 2);
    for (var e = 0, tries = 0; e < extra && tries < 200; tries++) {
      var v = { x: W * r.range(0.05, 0.95), y: H * r.range(0.08, s.horizon / H - 0.15), R: H * r.range(0.05, 0.075), dir: r.chance(0.5) ? 1 : -1 };
      if (Sky._clear(s, v.x, v.y, v.R * 1.6)) { s.vortices.push(v); e++; }
    }

    s.band = {
      y: cy + R * r.range(-0.2, 0.3), amp: H * r.range(0.03, 0.05),
      k: TAU / (W * r.range(0.35, 0.55)), ph: r.range(0, TAU), width: H * r.range(0.06, 0.09)
    };

    s.stars = [];
    var n = r.int(8, 12);
    for (var i = 0, t2 = 0; i < n && t2 < 2000; t2++) {
      var core = H * r.range(0.008, 0.015);
      var st = {
        x: W * r.range(0.04, 0.96), y: H * r.range(0.04, s.horizon / H - 0.1),
        core: core, halo: core * r.range(2.6, 3.6), ringW: Math.max(4 * s.k, core * 0.38),
        dir: r.chance(0.5) ? 1 : -1, rings: STAR_RINGS
      };
      if (!Sky._clear(s, st.x, st.y, st.halo * 1.2)) continue;
      if (s.cypress && s.cypress.covers(st.x, st.y, st.halo * 0.6)) continue;
      s.stars.push(st); i++;
    }
    s.glows = s.stars.concat([s.moon]);
  };

  // True if a disc at (x, y, rad) doesn't crowd the moon, swirls or existing stars.
  Sky._clear = function (s, x, y, rad) {
    var k, o;
    if (s.moon && dist(x, y, s.moon.x, s.moon.y) < s.moon.halo + rad) return false;
    for (k = 0; s.vortices && k < s.vortices.length; k++) {
      o = s.vortices[k];
      if (dist(x, y, o.x, o.y) < o.R * 0.9 + rad) return false;
    }
    for (k = 0; s.stars && k < s.stars.length; k++) {
      o = s.stars[k];
      if (dist(x, y, o.x, o.y) < o.halo + rad + s.W * 0.03) return false;
    }
    return true;
  };

  function bandY(s, x) { return s.band.y + s.band.amp * Math.sin(x * s.band.k + s.band.ph); }
  function bandSlope(s, x) { return s.band.amp * s.band.k * Math.cos(x * s.band.k + s.band.ph); }

  Sky.field = function (s) {
    return function (x, y) {
      var n = s.noise.noise2(x * 0.003, y * 0.003);
      var vx = 1;
      var vy = 0.3 * Math.sin(x * 0.0045 + y * 0.003 + n * 2.2) + 0.35 * n;

      var d = (y - bandY(s, x)) / s.band.width;
      vy = M.lerp(vy, bandSlope(s, x) * 1.4, Math.exp(-d * d));

      var i, o, dx, dy, r, f;
      for (i = 0; i < s.vortices.length; i++) {
        o = s.vortices[i]; dx = x - o.x; dy = y - o.y; r = Math.hypot(dx, dy) || 1e-3;
        f = 3.2 * Math.exp(-(r * r) / (o.R * o.R));
        vx += f * (-dy / r * o.dir - 0.18 * dx / r);
        vy += f * (dx / r * o.dir - 0.18 * dy / r);
      }
      for (i = 0; i < s.glows.length; i++) {
        o = s.glows[i]; dx = x - o.x; dy = y - o.y; r = Math.hypot(dx, dy) || 1e-3;
        var g = o.halo * 1.25;
        f = 4 * Math.exp(-(r * r) / (g * g));
        vx += f * (-dy / r * o.dir);
        vy += f * (dx / r * o.dir);
      }
      var l = Math.hypot(vx, vy) || 1;
      return [vx / l, vy / l];
    };
  };

  function inCrescent(m, x, y) {
    return dist(x, y, m.x, m.y) < m.core && dist(x, y, m.x + m.cut.dx, m.y + m.cut.dy) > m.cut.r;
  }

  // Which palette a sky stroke at (x, y) draws from.
  Sky.colorKey = function (s, x, y, rng) {
    var i, o, r;
    for (i = 0; i < s.glows.length; i++) {
      o = s.glows[i];
      r = dist(x, y, o.x, o.y);
      if (r > o.halo * 1.1) continue;
      if (r < o.core) {
        if (o.isMoon) return inCrescent(o, x, y) ? 'yellow' : 'orange';
        return rng.chance(0.6) ? 'cream' : 'yellow';
      }
      return o.rings[Math.min(o.rings.length - 1, Math.floor((r - o.core) / o.ringW))];
    }

    for (i = 0; i < s.vortices.length; i++) {
      o = s.vortices[i];
      r = dist(x, y, o.x, o.y);
      var w = 1 - M.smoothstep(o.R * 0.75, o.R * 1.1, r);
      if (w <= 0 || rng.random() > w) continue;
      if (r < o.R * 0.15) return rng.chance(0.5) ? 'pale' : 'cream';
      var ang = Math.atan2(y - o.y, x - o.x);
      var phase = r / (o.R * 0.2) + o.dir * ang / TAU * 2;
      var f = phase - Math.floor(phase);
      return f < 0.25 ? 'pale' : f < 0.5 ? 'light' : f < 0.75 ? 'mid' : f < 0.88 ? 'teal' : 'dark';
    }

    var bd = Math.abs(y - bandY(s, x)) / s.band.width;
    if (bd < 1 && rng.random() < (1 - bd) * 0.9) {
      var bn = s.noise.noise2(x * 0.01 + 7, y * 0.01);
      return bn > 0.15 ? 'pale' : bn > -0.2 ? 'light' : 'teal';
    }

    var t = M.clamp(y / s.horizon, 0, 1) + 0.25 * s.noise.noise2(x * 0.004 + 50, y * 0.004);
    var u = rng.random();
    if (u < 0.05) return 'dark';
    if (t < 0.3) return u < 0.7 ? 'deep' : 'mid';
    if (t < 0.65) return u < 0.25 ? 'deep' : u < 0.8 ? 'mid' : 'light';
    return u < 0.15 ? 'mid' : u < 0.6 ? 'light' : u < 0.8 ? 'pale' : 'teal';
  };

  Sky.paint = function (s, ops) {
    var W = s.W, H = s.H, k = s.k, rng = s.rng, dr = s.drawRng;
    var bottom = s.horizon + H * 0.1;

    ops.push(function (ctx) {
      var g = ctx.createLinearGradient(0, 0, 0, bottom);
      g.addColorStop(0, '#16296a');
      g.addColorStop(0.55, '#2f58a0');
      g.addColorStop(1, '#6e98cc');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, bottom);
    });

    var field = Sky.field(s), sp = 8.5 * k, list = [];
    for (var y = -sp; y < bottom; y += sp) {
      for (var x = -sp; x < W + sp; x += sp) {
        var px = x + rng.range(-sp, sp) * 0.5, py = y + rng.range(-sp, sp) * 0.5;
        var col = C.jitter(rng.pick(P[Sky.colorKey(s, px, py, rng)]), rng, 22);
        var pts = G.trace(field, px, py, rng.range(18, 32) * k, 5);
        list.push(strokeOp(pts, rng.range(5, 8) * k, col));
      }
    }
    rng.shuffle(list);
    for (var i = 0; i < list.length; i++) ops.push(list[i]);

    Sky.paintGlows(s, ops);

    function strokeOp(pts, w, col) { return function (ctx) { B.stroke(ctx, dr, pts, w, col); }; }
  };

  // Explicit concentric arcs around each star and the moon, on top of the field strokes.
  Sky.paintGlows = function (s, ops) {
    var rng = s.rng, dr = s.drawRng, k = s.k;
    s.glows.forEach(function (g) {
      var list = [];
      for (var r = g.core * 0.35; r < g.halo; r += g.ringW * 0.8) {
        var seg = M.clamp(r * 0.9, 6 * k, 26 * k);
        var n = Math.max(3, Math.ceil(TAU * r / seg));
        var a0 = rng.range(0, TAU), span = seg * 1.2 / r;
        for (var i = 0; i < n; i++) {
          var a = a0 + i / n * TAU + rng.range(-0.1, 0.1);
          var rr = r + rng.range(-0.25, 0.25) * g.ringW;
          var pts = [];
          for (var j = 0; j <= 4; j++) {
            var aj = a + g.dir * span * (j / 4 - 0.5);
            pts.push([g.x + Math.cos(aj) * rr, g.y + Math.sin(aj) * rr]);
          }
          var key = Sky.colorKey(s, pts[2][0], pts[2][1], rng);
          var w = M.clamp(g.ringW * rng.range(0.75, 1.05), 2.5 * k, 8 * k);
          list.push(arcOp(pts, w, C.jitter(rng.pick(P[key]), rng, 18)));
        }
      }
      rng.shuffle(list);
      for (var q = 0; q < list.length; q++) ops.push(list[q]);

      // Bright core
      var core = g.isMoon ? null : C.hex('#fffbe6');
      if (core) {
        ops.push(function (ctx) {
          var rg = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.core * 0.9);
          rg.addColorStop(0, 'rgba(255,253,240,0.95)');
          rg.addColorStop(1, 'rgba(250,236,160,0)');
          ctx.fillStyle = rg;
          ctx.beginPath(); ctx.arc(g.x, g.y, g.core * 0.9, 0, TAU); ctx.fill();
        });
      }
    });

    function arcOp(pts, w, col) { return function (ctx) { B.stroke(ctx, dr, pts, w, col); }; }
  };

  G.Sky = Sky;
})(window.GWF = window.GWF || {});
