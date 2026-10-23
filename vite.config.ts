import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:preview` produces one self-contained HTML (dist-preview/index.html)
// that can be opened by double-click, without npm.
export default defineConfig(({ mode }) => ({
  // relative asset URLs: the same build works at http://<ip>/OfficeX/ or any other base path set in server.json
  base: './',
  // listen on all interfaces so `npm run dev` is also reachable from the LAN / tailnet
  server: { host: true },
  preview: { host: true },
  plugins: mode === 'singlefile' ? [react(), viteSingleFile()] : [react()],
  build: mode === 'singlefile' ? { outDir: 'dist-preview', chunkSizeWarningLimit: 4000 } : { chunkSizeWarningLimit: 2000 },
}));
