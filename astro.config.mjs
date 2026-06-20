import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://www.ready-bridge.com',
  // 既定は静的生成。SSR が必要なルート（/api/chat 等）だけ
  // `export const prerender = false` でオンデマンド化する。
  adapter: cloudflare(),
});
