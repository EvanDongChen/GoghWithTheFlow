// The sleeping village: dark ground, little houses with lit windows, a church spire and round trees.
(function (G) {
  'use strict';
  var C = G.Color, M = G.math, B = G.Brush;
  var TAU = Math.PI * 2;

  var P = C.palette({
    ground: ['#1b2f4a', '#223a58', '#2b4a5c', '#2f4f4a', '#1e3540', '#3a5c56', '#28445e'],
    wall: ['#6a86a8', '#7f98b0', '#5a7896', '#8ea3a8', '#4f6f8f'],
    wallWarm: ['#b39a6a', '#a48d64', '#c2ab78'],
    roof: ['#2a3f6a', '#34507a', '#22365e', '#3d5a6e'],
    roofWarm: ['#8a5a3a', '#7a4e34', '#9a6a40'],
    window: ['#f4d04a', '#f2b53a', '#f7de6a'],
    tree: ['#1d3a3a', '#2a4a3a', '#355a45', '#1a2c40', '#24423f', '#3f6250'],
    outline: ['#101c3a', '#0c1630']
  });

  var Village = {};

  Village.setup = function (s) {
    var r = s.rng, W = s.W, H = s.H;
    function depthY(x, t) { var top = s.villageTop(x); return top + (H - top) * t; }

    s.church = (function () {
      var x = W * r.range(0.45, 0.62), base = depthY(x, r.range(0.22, 0.3));
      var bodyW = H * r.range(0.06, 0.075), bodyH = H * r.range(0.03, 0.04);
      return {
        x: x, base: base, bodyW: bodyW, bodyH: bodyH,
        towerW: H * 0.022, towerH: H * r.range(0.025, 0.035),
        spireTop: s.ridgeBack(x) - H * r.range(0.01, 0.04),
        warm: r.chance(0.3)
      };
    })();

    s.houses = [];
    var n = r.int(28, 42);
    for (var i = 0, tries = 0; i < n && tries < 600; tries++) {
      var x = W * r.range(0.02, 0.98), t = Math.pow(r.random(), 0.8);
      var y = depthY(x, M.lerp(0.12, 0.85, t)), size = H * M.lerp(0.018, 0.042, t);
      if (Math.abs(x - s.church.x) < s.church.bodyW && Math.abs(y - s.church.base) < size * 1.5) continue;
      var clash = s.houses.some(function (h) { return Math.abs(h.x - x) < (h.size + size) * 0.75 && Math.abs(h.y - y) < (h.size + size) * 0.35; });
      if (clash) continue;
      s.houses.push({
        x: x, y: y, size: size,
        w: size * r.range(0.9, 1.6), h: size * r.range(0.6, 0.9),
        peak: r.range(-0.25, 0.25), roofH: size * r.range(0.35, 0.6),
        warm: r.chance(0.2), warmRoof: r.chance(0.25),
        windows: r.int(0, 2)
      });
      i++;
    }

    s.trees = [];
    var nt = r.int(6, 10);
    for (var j = 0; j < nt; j++) {
      var edge = r.chance(0.4), tx = edge ? W * r.pick([r.range(0.75, 1.02), r.range(-0.02, 0.2)]) : W * r.random();
      var tt = r.range(0.05, 0.9);
      s.trees.push({ x: tx, y: depthY(tx, tt), r: H * (edge ? r.range(0.045, 0.075) : r.range(0.02, 0.04)) * M.lerp(0.7, 1.2, tt) });
    }
  };

  function clipFill(ctx, rng, poly, base, strokes) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (var i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
    ctx.fillStyle = C.css(base);
    ctx.fill();
    ctx.clip();
    strokes(ctx);
    ctx.restore();
  }

  function outline(ctx, rng, poly, w) {
    var pts = G.wobble(poly.concat([poly[0]]), rng, w * 0.35, 6);
    B.line(ctx, pts, w, rng.pick(P.outline), 0.9);
  }

  function drawHouse(ctx, rng, h, k) {
    var l = h.x - h.w / 2, r = h.x + h.w / 2, top = h.y - h.h, bot = h.y;
    var wallPal = h.warm ? P.wallWarm : P.wall, roofPal = h.warmRoof ? P.roofWarm : P.roof;
    var wall = [[l, top], [r, top], [r, bot], [l, bot]];
    var px = h.x + h.peak * h.w, oh = h.w * 0.08;
    var roof = [[l - oh, top], [px, top - h.roofH], [r + oh, top]];
    var sw = Math.max(2.5, h.size * 0.16);

    clipFill(ctx, rng, wall, wallPal[0], function () {
      for (var x = l; x < r + sw; x += sw * 0.7) {
        B.stroke(ctx, rng, [[x + rng.range(-1, 1), top - 2], [x + rng.range(-1, 1), (top + bot) / 2], [x + rng.range(-1, 1), bot + 2]], sw, C.jitter(rng.pick(wallPal), rng, 20));
      }
    });
    clipFill(ctx, rng, roof, roofPal[0], function () {
      for (var t = 0; t < 1; t += 0.12) {
        var y = top - h.roofH * t;
        B.stroke(ctx, rng, [[l - oh, y + rng.range(-1, 1)], [px, y - h.roofH * 0.15], [r + oh, y + rng.range(-1, 1)]], sw * 0.9, C.jitter(rng.pick(roofPal), rng, 18));
      }
    });

    for (var i = 0; i < h.windows; i++) {
      var ww = h.w * 0.16, wh = h.h * 0.32;
      var wx = l + h.w * (h.windows === 1 ? 0.42 : 0.2 + i * 0.45), wy = top + h.h * 0.3;
      ctx.fillStyle = C.css(C.jitter(rng.pick(P.window), rng, 20));
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = 'rgba(255,248,200,0.7)';
      ctx.fillRect(wx + ww * 0.25, wy + wh * 0.2, ww * 0.4, wh * 0.4);
    }

    var lw = Math.max(1.5, 2.2 * k);
    outline(ctx, rng, wall, lw);
    outline(ctx, rng, roof, lw);
  }

  function drawChurch(ctx, rng, c, k) {
    var l = c.x - c.bodyW / 2, r = c.x + c.bodyW / 2, top = c.base - c.bodyH;
    var tl = l + c.bodyW * 0.08, tr = tl + c.towerW, ttop = top - c.towerH;
    var mid = (tl + tr) / 2;
    var wallPal = c.warm ? P.wallWarm : P.wall;
    var sw = 4 * k;

    var body = [[l, top], [r, top], [r, c.base], [l, c.base]];
    var roof = [[l + c.towerW, top], [l + c.bodyW * 0.55, top - c.bodyH * 0.55], [r, top]];
    var tower = [[tl, ttop], [tr, ttop], [tr, c.base], [tl, c.base]];
    var spire = [[tl - 2 * k, ttop], [mid, c.spireTop], [tr + 2 * k, ttop]];

    clipFill(ctx, rng, roof, P.roof[0], function () {
      for (var y = top; y > top - c.bodyH * 0.6; y -= sw * 0.8) B.stroke(ctx, rng, [[l, y], [r, y - 1]], sw, C.jitter(rng.pick(P.roof), rng, 16));
    });
    [body, tower].forEach(function (poly) {
      clipFill(ctx, rng, poly, wallPal[0], function () {
        for (var x = l; x < r + sw; x += sw * 0.7) {
          B.stroke(ctx, rng, [[x, ttop - 2], [x + rng.range(-1, 1), (ttop + c.base) / 2], [x, c.base + 2]], sw, C.jitter(rng.pick(wallPal), rng, 18));
        }
      });
    });
    clipFill(ctx, rng, spire, P.roof[2], function () {
      for (var y = ttop; y > c.spireTop; y -= sw * 0.9) {
        B.stroke(ctx, rng, [[mid + rng.range(-1, 1), y], [mid + rng.range(-1, 1), y - sw * 3]], sw * 1.6, C.jitter(rng.pick(P.roof), rng, 16));
      }
    });
    ctx.fillStyle = C.css(rng.pick(P.window));
    ctx.fillRect(mid - c.towerW * 0.15, ttop + c.towerH * 0.3, c.towerW * 0.3, c.towerH * 0.3);

    var lw = 2.6 * k;
    [roof, body, tower, spire].forEach(function (poly) { outline(ctx, rng, poly, lw); });
  }

  function drawTree(ctx, rng, t, k) {
    ctx.fillStyle = C.css(P.tree[3]);
    ctx.beginPath(); ctx.ellipse(t.x, t.y - t.r * 0.8, t.r, t.r * 0.9, 0, 0, TAU); ctx.fill();
    var n = Math.round(t.r * t.r / (30 * k * k));
    for (var i = 0; i < n; i++) {
      var a = rng.range(0, TAU), rr = t.r * Math.sqrt(rng.random()) * 0.95;
      var cx = t.x + Math.cos(a) * rr, cy = t.y - t.r * 0.8 + Math.sin(a) * rr * 0.9;
      var pts = [];
      for (var j = 0; j < 4; j++) {
        var aj = a + Math.PI / 2 + (j - 1.5) * 0.25;
        pts.push([cx + Math.cos(aj) * j * 4 * k, cy + Math.sin(aj) * j * 4 * k]);
      }
      B.stroke(ctx, rng, pts, rng.range(4, 6.5) * k, C.jitter(rng.pick(P.tree), rng, 18));
    }
  }

  Village.paint = function (s, ops) {
    var W = s.W, H = s.H, k = s.k, rng = s.rng, dr = s.drawRng, N = s.noise;

    var ground = [];
    for (var x = -20; x <= W + 20; x += 10 * k) ground.push([x, s.villageTop(x)]);
    ground.push([W + 20, H + 20], [-20, H + 20]);
    ops.push(function (ctx) { B.fillPoly(ctx, ground, P.ground[0]); });

    var sp = 8 * k, list = [];
    for (var y = s.horizon; y < H + sp; y += sp) {
      for (x = -sp; x < W + sp; x += sp) {
        var px = x + rng.range(-0.5, 0.5) * sp, py = y + rng.range(-0.5, 0.5) * sp;
        if (py < s.villageTop(px) - 2) continue;
        var a = 0.9 * N.noise2(px * 0.006 + 30, py * 0.006) + rng.range(-0.25, 0.25);
        var len = rng.range(12, 22) * k;
        var pts = [[px - Math.cos(a) * len / 2, py - Math.sin(a) * len / 2], [px, py + rng.range(-1, 1)], [px + Math.cos(a) * len / 2, py + Math.sin(a) * len / 2]];
        list.push(strokeOp(pts, rng.range(4, 6.5) * k, C.jitter(rng.pick(P.ground), rng, 16)));
      }
    }
    rng.shuffle(list);
    for (var i = 0; i < list.length; i++) ops.push(list[i]);

    // Back to front so nearer things overlap farther ones.
    var items = [];
    s.houses.forEach(function (h) { items.push({ y: h.y, draw: function (ctx) { drawHouse(ctx, dr, h, k); } }); });
    s.trees.forEach(function (t) { items.push({ y: t.y, draw: function (ctx) { drawTree(ctx, dr, t, k); } }); });
    items.push({ y: s.church.base, draw: function (ctx) { drawChurch(ctx, dr, s.church, k); } });
    items.sort(function (a, b) { return a.y - b.y; });
    items.forEach(function (it) { ops.push(it.draw); });

    function strokeOp(pts, w, col) { return function (ctx) { B.stroke(ctx, dr, pts, w, col); }; }
  };

  G.Village = Village;
})(window.GWF = window.GWF || {});
