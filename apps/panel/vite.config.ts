import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const api = env.VITE_API_PROXY ?? 'http://localhost:4000';
  return {
    plugins: [react()],
    // Relative asset paths so the same build runs on the web and inside the Windows app (Tauri).
    base: './',
    server: {
      port: 5174,
      host: true,
      proxy: { '/api': { target: api }, '/uploads': { target: api } },
    },
    build: { target: 'es2022', sourcemap: true },
  };
});
