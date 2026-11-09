import { defineConfig } from 'vite';
export default defineConfig({ base: process.env.TAURI_ENV_PLATFORM ? '/' : process.env.VITE_BASE_PATH || '/', clearScreen: false, server: { port: 5173, strictPort: true } });
