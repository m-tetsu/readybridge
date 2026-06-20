// HTML / PDF からの本文・リンク抽出。
import * as cheerio from 'cheerio';
import { PDFParse } from 'pdf-parse';

// div ベースのグローバルナビ／パンくず／SNS等を class・id 名で狙い撃つセレクタ。
// 部分一致（[class*=...]）で gnav / globalnav / header-nav 等の派生も拾う。
const NAV_NOISE_KEYS = [
  'header', 'footer', 'gnav', 'globalnav', 'global-nav', 'navbar', 'menu',
  'breadcrumb', 'pankuzu', 'sitemap', 'sns', 'share', 'sidebar', 'side-nav',
  'pagetop', 'page-top', 'utility', 'language', 'lang-', 'skip',
];
const NAV_NOISE_SELECTOR = NAV_NOISE_KEYS
  .flatMap((k) => [`[class*="${k}"]`, `[id*="${k}"]`])
  .join(', ');

// HTML から タイトル・本文・リンクを抽出する。
export function extractHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const title = ($('title').first().text() || $('h1').first().text() || '').trim();

  // 本文抽出：装飾・ナビ等を除去し、main/article があればそこを優先。
  $('script, style, noscript, nav, header, footer, aside, iframe, form').remove();
  // セマンティックタグを使わない div ベースのグローバルナビを class/id で除去。
  // （jfc/mhlw 等は <nav> を使わずメニューを組むため、タグ除去だけでは漏れる）
  $(NAV_NOISE_SELECTOR).remove();
  const root = $('main').length ? $('main') : $('article').length ? $('article') : $('body');

  // リンクは本文領域からのみ収集（グローバルナビ由来のノイズを排除）。
  const links = [];
  root.find('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const u = new URL(href, baseUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        u.hash = '';
        links.push(u.toString());
      }
    } catch {
      /* 不正なURLは無視 */
    }
  });
  const text = normalize(root.text());

  return { title, text, links };
}

// PDF からテキストを抽出する（pdf-parse v2）。
export async function extractPdf(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return { title: '', text: normalize(result?.text || ''), links: [] };
  } finally {
    if (typeof parser.destroy === 'function') await parser.destroy();
  }
}

function normalize(s) {
  return s
    .replace(/\r/g, '')
    .replace(/[ \t　]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
