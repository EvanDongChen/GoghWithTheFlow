// Page wiring: seed handling, progressive painting, PNG export.
(function (G) {
  'use strict';

  var W = 1500, H = 1200;
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var seedInput = document.getElementById('seed');
  var animate = document.getElementById('animate');
  var progress = document.getElementById('progress');
  var runId = 0;

  canvas.width = W;
  canvas.height = H;

  function randomSeed() { return Math.random().toString(36).slice(2, 10); }

  function paint(seed) {
    seedInput.value = seed;
    var url = new URL(location.href);
    url.searchParams.set('seed', seed);
    history.replaceState(null, '', url);

    var ops = G.Painting.plan(seed, W, H).ops;
    var token = ++runId, i = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    progress.style.opacity = 1;
    document.body.dataset.done = '';

    function done() {
      progress.style.width = '100%';
      progress.style.opacity = 0;
      document.body.dataset.done = '1';
    }

    if (!animate.checked) {
      while (i < ops.length) ops[i++](ctx);
      return done();
    }

    (function frame() {
      if (token !== runId) return;
      var t0 = performance.now();
      while (i < ops.length && performance.now() - t0 < 14) ops[i++](ctx);
      progress.style.width = (100 * i / ops.length) + '%';
      if (i < ops.length) requestAnimationFrame(frame); else done();
    })();
  }

  document.getElementById('repaint').onclick = function () { paint(seedInput.value.trim() || randomSeed()); };
  document.getElementById('new').onclick = function () { paint(randomSeed()); };
  seedInput.onkeydown = function (e) { if (e.key === 'Enter') paint(seedInput.value.trim() || randomSeed()); };
  document.getElementById('save').onclick = function () {
    var a = document.createElement('a');
    a.download = 'starry-night-' + seedInput.value + '.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  var params = new URLSearchParams(location.search);
  if (params.get('animate') === '0') animate.checked = false;
  paint(params.get('seed') || randomSeed());
})(window.GWF = window.GWF || {});
