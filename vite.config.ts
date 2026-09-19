import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  base: './', // GitHub Pages などのサブディレクトリ公開に対応する相対パス設定
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'shield.svg', 'pwa-icon.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'KuroNuri Studio | 完全ローカル・プライバシー黒塗りカメラ',
        short_name: 'KuroNuri',
        description: '人名・会社名・顔写真・アバター・連絡先を外部送信ゼロ（完全ローカル）で自動黒塗り・墨消しするプライバシー保護カメラ。',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        // 任意のAI文章清書ランタイムは、通常の黒塗り起動では取得しない。
        globIgnores: ['**/ort-*.wasm', '**/localLlm-*.js'],
        // WASMファイル(約24MB)を含むためキャッシュ上限サイズを拡張
        maximumFileSizeToCacheInBytes: 35 * 1024 * 1024
      }
    })
  ]
});
