import type { APIRoute } from 'astro';

// Cloudflare エッジから任意の go.jp ページを fetch できるか確認する診断ルート（PoC）。
//
// 背景：chusho.meti.go.jp は Akamai 上にあり、GitHub Actions（Azure系IP）からは
//       接続段階で無言ドロップされる（http=000 / timeout）。Cloudflare エッジの
//       fetch なら Akamai を通過できる可能性があるため、まずここで疎通を確かめる。
//
// 使い方：/api/fetch-probe?url=https://www.chusho.meti.go.jp/saigai/r6_noto_jishin/index.html
//   既定（url 省略）は chusho 能登ページ。許可は .go.jp / .lg.jp のみ。
//
// 通れば、収集パイプラインの chusho 取得をこのエッジ経由 fetch に置き換える。
export const prerender = false;

const DEFAULT_URL = 'https://www.chusho.meti.go.jp/saigai/r6_noto_jishin/index.html';
const ALLOWED_SUFFIXES = ['.go.jp', '.lg.jp'];

function hostAllowed(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return ALLOWED_SUFFIXES.some((suf) => h.endsWith(suf));
  } catch {
    return false;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const target = new URL(request.url).searchParams.get('url') || DEFAULT_URL;

  if (!hostAllowed(target)) {
    return Response.json({ ok: false, error: 'url must be .go.jp / .lg.jp', target }, { status: 400 });
  }

  const started = Date.now();
  try {
    const res = await fetch(target, {
      headers: {
        // ブラウザ相当の UA（bot 判定を避ける）。
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/pdf,*/*',
        'accept-language': 'ja,en;q=0.8',
      },
      redirect: 'follow',
      // @ts-expect-error Cloudflare 拡張：エッジキャッシュは使わず常に取りに行く。
      cf: { cacheTtl: 0, cacheEverything: false },
    });

    const body = await res.arrayBuffer();
    return Response.json({
      ok: res.ok,
      target,
      status: res.status,
      contentType: res.headers.get('content-type'),
      bytes: body.byteLength,
      elapsedMs: Date.now() - started,
    });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    return Response.json(
      {
        ok: false,
        target,
        error: `${err.name || 'error'}: ${(err.message || '').slice(0, 200)}`,
        elapsedMs: Date.now() - started,
      },
      { status: 502 },
    );
  }
};
