import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  build: {
    // El service worker (workbox) precachea TODOS los chunks JS, así que los
    // `<link rel="modulepreload">` que inyecta Vite son redundantes y solo
    // generan avisos en consola ("cross-world service worker resource mismatch"
    // / "preloaded but not used"). Se desactivan.
    modulePreload: false,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'QR Inventarios by NelSystems',
        short_name: 'QR Inventarios',
        description:
          'Doble conteo ciego triangulado y generación de etiquetas QR de inventario.',
        theme_color: '#0b7285',
        background_color: '#f4f6f8',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell + assets cacheados para trabajar sin conexión en piso de bodega.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,mjs}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
});
