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
  build: {
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            if (id.includes('/src/modules/nightworkers/components/ArtifactPane.tsx')) {
              return 'nightworkers-artifacts';
            }
            if (id.includes('/src/modules/nightworkers/components/ThreadTimeline.tsx')) {
              return 'nightworkers-timeline';
            }
            if (id.includes('/src/modules/nightworkers/components/ThreadWorkspace.tsx')) {
              return 'nightworkers-workspace';
            }
            if (id.includes('/src/modules/nightworkers/components/SettingsScreen.tsx')) {
              return 'nightworkers-settings';
            }
            if (id.includes('/src/modules/nightworkers/components/OverviewScreen.tsx')) {
              return 'nightworkers-overview';
            }
            if (id.includes('/src/modules/nightworkers/components/blueprint-preview/')) {
              return 'nightworkers-blueprint-preview';
            }
            return undefined;
          }
          if (id.includes('/react/') || id.includes('/react-dom/')) return 'vendor-react';
          if (id.includes('/@tanstack/')) return 'vendor-tanstack';
          if (id.includes('/radix-ui/') || id.includes('/lucide-react/')) return 'vendor-ui';
          if (id.includes('/recharts/') || id.includes('/d3-')) return 'vendor-charts';
          if (
            id.includes('/react-markdown/') ||
            id.includes('/remark-gfm/') ||
            id.includes('/micromark') ||
            id.includes('/mdast') ||
            id.includes('/hast') ||
            id.includes('/unified/') ||
            id.includes('/unist-')
          ) {
            return 'vendor-markdown';
          }
          return undefined;
        },
      },
    },
  },
});
