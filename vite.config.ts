import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const devReloadDirs = [path.resolve(__dirname, './api'), path.resolve(__dirname, './src')];

function isApiOrSrcPath(file: string) {
  const resolved = path.resolve(file);
  return devReloadDirs.some(
    (dir) =>
      resolved === dir ||
      resolved.startsWith(`${dir}${path.sep}`) ||
      dir.startsWith(`${resolved}${path.sep}`)
  );
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@api': path.resolve(__dirname, './api'),
    },
  },
  server: {
    port: 39174,
    strictPort: true,
    watch: {
      ignored: (file) => !isApiOrSrcPath(file),
    },
    proxy: {
      '/api': {
        target: 'http://localhost:39173',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
