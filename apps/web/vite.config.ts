import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const api = env.VITE_API_PROXY ?? 'http://localhost:4000';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      // In production nginx routes /api and /uploads on each gym's subdomain to the API.
      proxy: {
        '/api': { target: api, changeOrigin: false },
        '/uploads': { target: api },
      },
    },
    build: { target: 'es2022', sourcemap: true },
  };
});
