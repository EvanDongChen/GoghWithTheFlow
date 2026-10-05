// The cypress: a dark, flame-like tree licking up into the sky from the foreground.
(function (G) {
  'use strict';
  var C = G.Color, M = G.math, B = G.Brush;

  var P = C.palette({
    dark: ['#14231b', '#1a2c20', '#0f1a15', '#172619'],
    mid: ['#203626', '#263f28', '#2e4526', '#233629'],
    brown: ['#3e3220', '#4b3b22', '#5a4428'],
    hi: ['#4f6233', '#5f6b3c', '#455e37', '#6b7042', '#3d5a6a'],
    outline: ['#0a120e', '#0d1712']
  });

  var Cypress = {};

  Cypress.setup = function (s) {
    var r = s.rng, W = s.W, H = s.H, N = s.noise;
    var c = {
      x: W * r.range(0.1, 0.2), top: H * r.range(0.03, 0.1), base: H * 1.02,
      w: W * r.range(0.11, 0.15), ph: r.range(0, 6.28), lean: r.range(-0.3, 0.3), o: r.range(0, 100),
      lobes: r.range(22, 34)
    };
    c.t = function (y) { return (c.base - y) / (c.base - c.top); };
    c.center = function (t) { return c.x + c.w * (0.12 * Math.sin(t * 4 + c.ph) + c.lean * 0.3 * t); };
    function prof(t) { return Math.pow(Math.max(0, 1 - t), 0.75) * (0.8 + 0.2 * Math.min(1, t * 5)); }
    // Skewed-sine lobes: each edge swells slowly then pulls in quickly, giving upward-leaning flame tongues.
    function tongue(t, freq, ph) { var a = 6.2832 * (t * freq + ph); return 0.5 + 0.5 * Math.sin(a + 0.8 * Math.sin(a)); }
    c.halfL = function (t) { return c.w * 0.5 * prof(t) * (0.72 + 0.5 * tongue(t, c.lobes / 6.28, c.ph) + 0.2 * N.noise2(t * 7, c.o)); };
    c.halfR = function (t) { return c.w * 0.5 * prof(t) * (0.72 + 0.5 * tongue(t, c.lobes * 0.85 / 6.28, c.ph + 0.4) + 0.2 * N.noise2(t * 7, c.o + 9)); };
    c.inside = function (x, y) {
      var t = c.t(y);
      if (t < 0 || t > 1) return false;
      var cx = c.center(t);
      return x > cx - c.halfL(t) && x < cx + c.halfR(t);
    };
    c.covers = function (x, y, pad) {
      var t = c.t(y);
      if (t < -0.02 || t > 1) return false;
      var cx = c.center(M.clamp(t, 0, 1));
      return x > cx - c.halfL(t) - pad && x < cx + c.halfR(t) + pad;
    };
    s.cypress = c;
  };

  Cypress.paint = function (s, ops) {
    var c = s.cypress, k = s.k, rng = s.rng, dr = s.drawRng;
    var steps = 120, left = [], right = [], i, t, y;
    for (i = 0; i <= steps; i++) {
      t = i / steps; y = c.base - t * (c.base - c.top);
      left.push([c.center(t) - c.halfL(t), y]);
      right.push([c.center(t) + c.halfR(t), y]);
    }
    var poly = left.concat(right.slice().reverse());
    ops.push(function (ctx) { B.fillPoly(ctx, poly, P.dark[0]); });

    var field = function (x, y) {
      var t = M.clamp(c.t(y), 0, 1), cx = c.center(t);
      var half = (x < cx ? c.halfL(t) : c.halfR(t)) || 1;
      var u = M.clamp((x - cx) / half, -1, 1);
      var dc = (c.center(t + 0.01) - c.center(t)) / (0.01 * (c.base - c.top));
      var a = 0.5 * Math.sin(t * 16 + u * 2 + c.ph) + 0.35 * u + dc;
      return [Math.sin(a), -Math.cos(a)];
    };

    var sp = 6 * k, list = [];
    for (y = c.top - sp; y < c.base + sp; y += sp) {
      for (var x = c.x - c.w; x < c.x + c.w; x += sp) {
        var px = x + rng.range(-0.5, 0.5) * sp, py = y + rng.range(-0.5, 0.5) * sp;
        if (!c.inside(px, py)) continue;
        var u = rng.random(), pal = u < 0.45 ? P.dark : u < 0.77 ? P.mid : u < 0.9 ? P.brown : P.hi;
        var pts = G.trace(field, px, py, rng.range(26, 46) * k, 6);
        list.push(strokeOp(pts, rng.range(5, 8.5) * k, C.jitter(rng.pick(pal), rng, 14)));
      }
    }
    rng.shuffle(list);
    for (i = 0; i < list.length; i++) ops.push(list[i]);

    // Dark contour strokes along both edges, in short overlapping pieces.
    [left, right].forEach(function (edge) {
      for (var a = 0; a < edge.length - 1; a += rng.int(5, 9)) {
        var seg = edge.slice(a, Math.min(edge.length, a + rng.int(8, 14)));
        if (seg.length > 1) ops.push(lineOp(G.wobble(seg, rng, 1.5 * k, 8 * k), rng.range(3, 5) * k, rng.pick(P.outline)));
      }
    });

    function strokeOp(pts, w, col) { return function (ctx) { B.stroke(ctx, dr, pts, w, col); }; }
    function lineOp(pts, w, col) { return function (ctx) { B.line(ctx, pts, w, col, 0.8); }; }
  };

  G.Cypress = Cypress;
})(window.GWF = window.GWF || {});
