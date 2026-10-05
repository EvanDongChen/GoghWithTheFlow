// Impasto brush: thick strokes with shadow, bristle streaks and a highlight ridge.
(function (G) {
  'use strict';
  var C = G.Color;

  // Smooth path through points using midpoint quadratic curves.
  function pathOf(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length - 1; i++) {
      var mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    var l = pts[pts.length - 1];
    ctx.lineTo(l[0], l[1]);
  }

  // Shift a polyline sideways along its normal by distance d.
  function offset(pts, d) {
    var out = new Array(pts.length);
    for (var i = 0; i < pts.length; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      out[i] = [pts[i][0] - ty / l * d, pts[i][1] + tx / l * d];
    }
    return out;
  }

  // Drop a fraction of points from either end, so streaks look shorter than the body.
  function trim(pts, rng) {
    if (pts.length < 4) return pts;
    var a = rng.random() < 0.5 ? 1 : 0, b = rng.random() < 0.5 ? 1 : 0;
    return pts.slice(a, pts.length - b);
  }

  var Brush = {
    stroke: function (ctx, rng, pts, w, col) {
      if (pts.length < 2) return;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.lineWidth = w * 1.1;
      ctx.strokeStyle = C.css(C.darken(col, 0.5), 0.3);
      pathOf(ctx, offset(pts, w * 0.22)); ctx.stroke();

      ctx.lineWidth = w;
      ctx.strokeStyle = C.css(col);
      pathOf(ctx, pts); ctx.stroke();

      var n = w > 6 ? 3 : 2;
      for (var k = 0; k < n; k++) {
        var light = rng.random() < 0.55;
        ctx.lineWidth = Math.max(0.7, w * rng.range(0.1, 0.22));
        ctx.strokeStyle = C.css(light ? C.lighten(col, rng.range(0.12, 0.3)) : C.darken(col, rng.range(0.1, 0.28)), rng.range(0.4, 0.7));
        pathOf(ctx, offset(trim(pts, rng), rng.range(-0.38, 0.38) * w)); ctx.stroke();
      }

      ctx.lineWidth = Math.max(0.6, w * 0.14);
      ctx.strokeStyle = C.css(C.lighten(col, 0.4), 0.35);
      pathOf(ctx, offset(pts, -w * 0.28)); ctx.stroke();
    },

    // Plain line, used for outlines.
    line: function (ctx, pts, w, col, alpha) {
      if (pts.length < 2) return;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = w;
      ctx.strokeStyle = C.css(col, alpha);
      pathOf(ctx, pts); ctx.stroke();
    },

    fillPoly: function (ctx, pts, col) {
      ctx.fillStyle = C.css(col);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
    }
  };

  // Trace a stroke through a vector field, centered on (x, y).
  function trace(field, x, y, len, steps) {
    var h = len / steps, half = Math.max(1, Math.floor(steps / 2));
    var back = [], fwd = [[x, y]], px = x, py = y, v, i;
    for (i = 0; i < half; i++) { v = field(px, py); px -= v[0] * h; py -= v[1] * h; back.push([px, py]); }
    px = x; py = y;
    for (i = 0; i < steps - half; i++) { v = field(px, py); px += v[0] * h; py += v[1] * h; fwd.push([px, py]); }
    return back.reverse().concat(fwd);
  }

  // Break a long polyline into wobbly segments of roughly segLen.
  function wobble(pts, rng, amt, segLen) {
    var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / segLen));
      for (var j = 0; j < n; j++) {
        var t = j / n;
        out.push([a[0] + (b[0] - a[0]) * t + rng.range(-amt, amt), a[1] + (b[1] - a[1]) * t + rng.range(-amt, amt)]);
      }
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  }

  G.Brush = Brush;
  G.trace = trace;
  G.wobble = wobble;
})(window.GWF = window.GWF || {});
