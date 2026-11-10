import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ base: process.env.TAURI_ENV_PLATFORM ? '/' : process.env.VITE_BASE_PATH || '/', clearScreen: false,
  server: { port: 5173, strictPort: true }, build: { rollupOptions: { input: {
    main: fileURLToPath(new URL('./index.html', import.meta.url)), partyPreview: fileURLToPath(new URL('./party-preview.html', import.meta.url)),
    management: fileURLToPath(new URL('./management.html', import.meta.url)), control: fileURLToPath(new URL('./control.html', import.meta.url)),
  } } } });
