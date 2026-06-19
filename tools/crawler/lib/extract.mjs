// HTML / PDF からの本文・リンク抽出。
import * as cheerio from 'cheerio';
import { PDFParse } from 'pdf-parse';

// HTML から タイトル・本文・リンクを抽出する。
export function extractHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const title = ($('title').first().text() || $('h1').first().text() || '').trim();

  // リンクは本文除去の前に集める。
  const links = [];
  $('a[href]').each((_, el) => {
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

  // 本文抽出：装飾・ナビ等を除去し、main/article があればそこを優先。
  $('script, style, noscript, nav, header, footer, aside, iframe, form').remove();
  const root = $('main').length ? $('main') : $('article').length ? $('article') : $('body');
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
