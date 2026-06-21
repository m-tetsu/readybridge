import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.ready-bridge.com',
  // 既定は静的生成。SSR が必要なルート（/api/chat 等）だけ
  // `export const prerender = false` でオンデマンド化する。
  adapter: cloudflare(),
  integrations: [
    sitemap({
      // SSR 用の API ルートは sitemap から除外（実ページのみ収録）。
      filter: (page) => !page.includes('/api/'),
    }),
  ],
});
