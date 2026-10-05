// Composes a scene from a seed and plans it as an ordered list of draw operations.
(function (G) {
  'use strict';

  function plan(seed, W, H) {
    var s = {
      seed: seed, W: W, H: H, k: W / 1500,
      rng: new G.Rng(G.hashString(seed)),
      drawRng: new G.Rng(G.hashString(seed + ':draw')),
      noise: new G.Noise(new G.Rng(G.hashString(seed + ':noise')))
    };
    s.mirror = s.rng.chance(0.25);
    s.horizon = H * s.rng.range(0.58, 0.63);

    // Order matters: the sky places stars around the cypress, the village sits under the hills.
    var parts = [G.Land, G.Cypress, G.Sky, G.Village].filter(Boolean);
    parts.forEach(function (p) { p.setup(s); });

    var ops = [];
    if (s.mirror) ops.push(function (ctx) { ctx.setTransform(-1, 0, 0, 1, W, 0); });
    [G.Sky, G.Land, G.Village, G.Cypress].filter(Boolean).forEach(function (p) { p.paint(s, ops); });
    ops.push(function (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); });
    ops.push(function (ctx) { finish(ctx, s); });
    return { scene: s, ops: ops };
  }

  // Canvas weave and a soft vignette over the finished painting.
  function finish(ctx, s) {
    var W = s.W, H = s.H, rng = new G.Rng(G.hashString(s.seed + ':canvas'));
    var tile = document.createElement('canvas');
    tile.width = tile.height = 64;
    var tc = tile.getContext('2d'), img = tc.createImageData(64, 64);
    for (var y = 0; y < 64; y++) {
      for (var x = 0; x < 64; x++) {
        var weave = ((x >> 1) + (y >> 1)) & 1 ? 10 : -10;
        var v = 128 + weave * 0.6 + (rng.random() - 0.5) * 36;
        var i = (y * 64 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    tc.putImageData(img, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    ctx.save();
    var g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(5,10,30,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  G.Painting = { plan: plan };
})(window.GWF = window.GWF || {});
