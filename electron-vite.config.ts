import { defineConfig } from 'electron-vite';
import { copyFileSync } from 'fs';
import { join } from 'path';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: 'src/main/index.ts',
        plugins: [
          {
            name: 'copy-delay-page',
            closeBundle() {
              // Copy delay-page.html to build output
              const src = join(__dirname, 'src/main/delay-page.html');
              const dest = join(__dirname, 'out/main/delay-page.html');
              copyFileSync(src, dest);
              console.log('Copied delay-page.html to build output');
            }
          }
        ]
      },
    },
  },
});
