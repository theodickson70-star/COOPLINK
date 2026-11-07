import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Wakati wa kutengeneza (npm run dev:admin) maombi ya /api yanapelekwa kwa backend (port 4000).
// Kwenye Railway, admin na API ziko kwenye anwani moja, kwa hiyo hakuna CORS wala URL ya kuweka.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
