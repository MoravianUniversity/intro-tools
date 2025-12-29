import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: '.',
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
      }
    }
  },
  server: {
    open: '/function-planner.html'
  }
});
