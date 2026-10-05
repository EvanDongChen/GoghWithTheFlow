// Core utilities: seeded RNG, Perlin noise, math and color helpers.
(function (G) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function Rng(seed) { this._next = mulberry32(seed >>> 0); }
  Rng.prototype.random = function () { return this._next(); };
  Rng.prototype.range = function (a, b) { return a + (b - a) * this._next(); };
  Rng.prototype.int = function (a, b) { return Math.floor(this.range(a, b + 1)); };
  Rng.prototype.chance = function (p) { return this._next() < p; };
  Rng.prototype.pick = function (arr) { return arr[Math.floor(this._next() * arr.length)]; };
  Rng.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this._next() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  // Classic 2D Perlin noise with a seeded permutation table. Output roughly in [-1, 1].
  var GRAD = [[1, 0], [-1, 0], [0, 1], [0, -1],
    [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];

  function Noise(rng) {
    var p = [];
    for (var i = 0; i < 256; i++) p[i] = i;
    rng.shuffle(p);
    this.perm = new Uint8Array(512);
    for (var j = 0; j < 512; j++) this.perm[j] = p[j & 255];
  }
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function grad(h, dx, dy) { var g = GRAD[h & 7]; return g[0] * dx + g[1] * dy; }
  Noise.prototype.noise2 = function (x, y) {
    var X = Math.floor(x), Y = Math.floor(y);
    var xf = x - X, yf = y - Y;
    X &= 255; Y &= 255;
    var p = this.perm;
    var aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    var u = fade(xf), v = fade(yf);
    var x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    var x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 1.414;
  };
  Noise.prototype.fbm = function (x, y, octaves) {
    var sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (var i = 0; i < (octaves || 3); i++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smoothstep(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  var Color = {
    hex: function (h) {
      var n = parseInt(h.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },
    css: function (c, a) {
      var r = c[0] | 0, g = c[1] | 0, b = c[2] | 0;
      return a === undefined ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    },
    mix: function (a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; },
    lighten: function (c, t) { return Color.mix(c, [255, 255, 255], t); },
    darken: function (c, t) { return Color.mix(c, [0, 0, 0], t); },
    jitter: function (c, rng, amt) {
      var d = (rng.random() - 0.5) * amt; // shared shift keeps hue, small per-channel noise varies it
      return [
        clamp(c[0] + d + (rng.random() - 0.5) * amt * 0.5, 0, 255),
        clamp(c[1] + d + (rng.random() - 0.5) * amt * 0.5, 0, 255),
        clamp(c[2] + d + (rng.random() - 0.5) * amt * 0.5, 0, 255)
      ];
    },
    palette: function (obj) {
      var out = {};
      for (var k in obj) out[k] = obj[k].map(Color.hex);
      return out;
    }
  };

  G.Rng = Rng;
  G.Noise = Noise;
  G.hashString = hashString;
  G.math = { lerp: lerp, clamp: clamp, smoothstep: smoothstep };
  G.Color = Color;
})(window.GWF = window.GWF || {});
