import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: '/video-mosaic-webapp/',
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
});
