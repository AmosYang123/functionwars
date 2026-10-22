import { defineConfig } from 'vite';

/**
 * Bundles the online game server (server/vercel-ws.ts plus the shared engine)
 * into api/ws.js, the Vercel Function behind /ws. Dependencies stay external;
 * Vercel traces them from node_modules. Pre-bundled because Vercel's own
 * TypeScript step can't read this repo's `.ts` import paths with TypeScript 7.
 */
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'server/vercel-ws.ts',
    outDir: 'api',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'ws.js' } },
  },
});
