import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The build is one self-contained index.html (scripts, styles and the painting worker inlined),
// so it can be hosted anywhere or simply double-clicked and opened from disk.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
});
