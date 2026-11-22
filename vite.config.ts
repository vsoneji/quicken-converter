import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Bank Statement to QIF Converter',
        short_name: 'QIF Converter',
        description: '100% offline client-side CSV, XLS, XLSX, and PDF to QIF converter.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,mjs,wasm}']
      }
    })
  ],
  optimizeDeps: {
    exclude: ['pdfjs-dist']
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
