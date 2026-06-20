import type { APIRoute } from 'astro';

// 公的サイトの取得を Cloudflare エッジ経由で中継するプロキシ。
//
// 背景：chusho.meti.go.jp 等は Akamai 上にあり、GitHub Actions（Azure系IP）からは
//       接続段階で無言ドロップされる。一方 Cloudflare エッジからの fetch は通る
//       （/api/fetch-probe で status=200 を確認済み）。そこで収集パイプラインは
//       遮断ホストだけこのルート経由で取得する。
//
// 使い方：/api/gov-proxy?url=<.go.jp / .lg.jp の絶対URL>
//   上流のレスポンス本文を Content-Type を保ったまま透過返却する（HTML/PDF両対応）。
//   許可は .go.jp / .lg.jp のみ（オープンプロキシ濫用・SSRF を抑制）。
export const prerender = false;

const ALLOWED_SUFFIXES = ['.go.jp', '.lg.jp'];
const MAX_BYTES = 25 * 1024 * 1024; // 25MB 上限（大きすぎる添付の暴発を防ぐ）

function hostAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return ALLOWED_SUFFIXES.some((suf) => u.hostname.endsWith(suf));
  } catch {
    return false;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const target = new URL(request.url).searchParams.get('url');

  if (!target || !hostAllowed(target)) {
    return new Response('url must be an absolute .go.jp / .lg.jp URL', { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/pdf,*/*',
        'accept-language': 'ja,en;q=0.8',
      },
      redirect: 'follow',
      // @ts-expect-error Cloudflare 拡張：エッジキャッシュを使わず常に取りに行く。
      cf: { cacheTtl: 0, cacheEverything: false },
    });

    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES) {
      return new Response('upstream too large', { status: 502 });
    }

    return new Response(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        // 中継元を示しておく（デバッグ用）。
        'x-proxy-target': target,
      },
    });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    return new Response(`proxy error: ${err.name || 'error'}: ${(err.message || '').slice(0, 200)}`, {
      status: 502,
    });
  }
};
