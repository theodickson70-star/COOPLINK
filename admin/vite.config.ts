import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

// Toleo linachukuliwa kutoka package.json ya mradi mzima
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// Wakati wa kutengeneza (npm run dev:admin) maombi ya /api yanapelekwa kwa backend (port 4000).
// Kwenye Railway, admin na API ziko kwenye anwani moja, kwa hiyo hakuna CORS wala URL ya kuweka.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      // React na router kwenye faili lao: haibadiliki mara kwa mara, kwa hiyo kivinjari kinaihifadhi kati ya matoleo
      output: { manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom'] } },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
