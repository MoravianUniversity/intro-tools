import { defineConfig } from 'vite';
import cdn from 'vite-plugin-cdn-import';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: './',
  base: './',
  build: {
    rollupOptions: {
      input: {
        'function-planner': resolve(__dirname, 'function-planner.html'),
        'call-graph': resolve(__dirname, 'call-graph.html'),
        'ipo': resolve(__dirname, 'ipo.html'),
        'grades': resolve(__dirname, 'grades.html'),
        'number-guess': resolve(__dirname, 'number-guess.html'),
        'hangman-planner': resolve(__dirname, 'hangman.html'),
        'bigrams': resolve(__dirname, 'bigrams.html'),
        'cell-phone-family-plan': resolve(__dirname, 'cell-phone-family-plan.html'),
        'madlibs': resolve(__dirname, 'madlibs.html'),
        'final': resolve(__dirname, 'final.html'),
      },
      output: {
        manualChunks: {
          yjs: ['yjs', 'y-websocket', 'y-indexeddb', 'fast-diff'],
          ui: ['prismjs', 'sortablejs', 'sweetalert2'],
          // gojs: ['gojs'],
        }
      }
    }
  },
  plugins: [
    cdn({
      modules: [
        {name: 'gojs', var: 'go', path: `release/go.js`},
      ],
    }),
],
  server: {
    open: '/function-planner.html'
  }
});
