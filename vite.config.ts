import { cloudflare } from '@cloudflare/vite-plugin';
import { foldkit } from '@foldkit/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  plugins: [foldkit(), tailwindcss(), cloudflare({ configPath: '../wrangler.jsonc' })],
  optimizeDeps: { exclude: ['handwired'] },
  build: { outDir: '../dist/client', emptyOutDir: true },
});
