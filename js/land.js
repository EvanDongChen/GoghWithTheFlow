// Rolling blue hills along the horizon, painted with strokes that follow the ridgelines.
(function (G) {
  'use strict';
  var C = G.Color, M = G.math, B = G.Brush;

  var P = C.palette({
    back: ['#23447f', '#2d5492', '#3a64a2', '#5079b3', '#1c3a72'],
    backHi: ['#6f97c6', '#8aaed3'],
    front: ['#2a4f6e', '#335d7c', '#3f6c86', '#4b7a86', '#2d5468', '#557e7a'],
    frontHi: ['#79a0a6', '#6d96b0'],
    outline: ['#11234a', '#0f1f40']
  });

  var Land = {};

  Land.setup = function (s) {
    var r = s.rng, W = s.W, H = s.H, N = s.noise;
    var tilt = r.range(0.04, 0.09);
    var o1 = r.range(0, 100), o2 = r.range(0, 100), o3 = r.range(0, 100);
    var gap1 = H * r.range(0.05, 0.075), gap2 = H * r.range(0.04, 0.06);

    s.ridgeBack = function (x) {
      return s.horizon - H * tilt * (x / W - 0.5) + H * 0.065 * N.fbm(x * 0.0018 + o1, o1, 3);
    };
    s.ridgeFront = function (x) {
      return s.ridgeBack(x) + gap1 + H * 0.03 * N.fbm(x * 0.0025 + o2, o2, 2);
    };
    s.villageTop = function (x) {
      return s.ridgeFront(x) + gap2 + H * 0.012 * N.noise2(x * 0.004 + o3, o3);
    };
  };

  function slope(f, x) { return (f(x + 4) - f(x - 4)) / 8; }

  function bandPoly(s, top, bottom) {
    var pts = [], x, step = 10 * s.k;
    for (x = -20; x <= s.W + 20; x += step) pts.push([x, top(x)]);
    for (x = s.W + 20; x >= -20; x -= step) pts.push([x, bottom(x) + 6]);
    return pts;
  }

  Land.paint = function (s, ops) {
    var W = s.W, k = s.k, rng = s.rng, dr = s.drawRng, N = s.noise;
    var backPoly = bandPoly(s, s.ridgeBack, s.ridgeFront);
    var frontPoly = bandPoly(s, s.ridgeFront, s.villageTop);
    ops.push(function (ctx) {
      B.fillPoly(ctx, backPoly, P.back[1]);
      B.fillPoly(ctx, frontPoly, P.front[1]);
    });

    var field = function (x, y) {
      var b = s.ridgeBack(x), f = s.ridgeFront(x), v = s.villageTop(x), sl;
      if (y < f) sl = M.lerp(slope(s.ridgeBack, x), slope(s.ridgeFront, x), M.clamp((y - b) / (f - b), 0, 1));
      else sl = M.lerp(slope(s.ridgeFront, x), slope(s.villageTop, x), M.clamp((y - f) / (v - f), 0, 1));
      sl += 0.15 * N.noise2(x * 0.01, y * 0.01);
      var l = Math.hypot(1, sl);
      return [1 / l, sl / l];
    };

    var sp = 8 * k, list = [], y0 = Infinity, y1 = -Infinity, x;
    for (x = 0; x <= W; x += 20) { y0 = Math.min(y0, s.ridgeBack(x)); y1 = Math.max(y1, s.villageTop(x)); }
    for (var y = y0 - sp; y < y1 + sp; y += sp) {
      for (x = -sp; x < W + sp; x += sp) {
        var px = x + rng.range(-0.5, 0.5) * sp, py = y + rng.range(-0.5, 0.5) * sp;
        if (py < s.ridgeBack(px) + 2 || py > s.villageTop(px) + 4) continue;
        var isBack = py < s.ridgeFront(px);
        var pal = isBack ? (rng.chance(0.12) ? P.backHi : P.back) : (rng.chance(0.1) ? P.frontHi : P.front);
        var pts = G.trace(field, px, py, rng.range(26, 44) * k, 5);
        list.push(strokeOp(pts, rng.range(4.5, 7) * k, C.jitter(rng.pick(pal), rng, 18)));
      }
    }
    rng.shuffle(list);
    for (var i = 0; i < list.length; i++) ops.push(list[i]);

    // Dark ridgelines, Van Gogh's outlines.
    [s.ridgeBack, s.ridgeFront].forEach(function (f) {
      for (var xs = -20; xs < W + 20; xs += rng.range(50, 90) * k) {
        var seg = [], len = rng.range(60, 110) * k;
        for (var t = 0; t <= 6; t++) { var xx = xs + len * t / 6; seg.push([xx, f(xx) + rng.range(-1, 1) * k]); }
        ops.push(lineOp(seg, rng.range(2.5, 4) * k, rng.pick(P.outline)));
      }
    });

    function strokeOp(pts, w, col) { return function (ctx) { B.stroke(ctx, dr, pts, w, col); }; }
    function lineOp(pts, w, col) { return function (ctx) { B.line(ctx, pts, w, col, 0.85); }; }
  };

  G.Land = Land;
})(window.GWF = window.GWF || {});
