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
        // 'bigrams-planner': resolve(__dirname, 'bigrams-planner.html'),
        // 'cell-phone-family-plan': resolve(__dirname, 'cell-phone-family-plan.html'),
        // 'grades-planner': resolve(__dirname, 'grades-planner.html'),
        // 'hangman-planner': resolve(__dirname, 'hangman-planner.html'),
        // 'ipo-planner': resolve(__dirname, 'ipo-planner.html'),
        // 'madlibs-planner': resolve(__dirname, 'madlibs-planner.html'),
        // 'number-guess-planner': resolve(__dirname, 'number-guess-planner.html'),
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
