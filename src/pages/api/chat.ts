import type { APIRoute } from 'astro';

// このルートはオンデマンド（SSR）で実行する。
export const prerender = false;

// 生成モデル。基本は Haiku 一本（論点⑥）。
// 将来 Opus へエスカレーションする場合は、この1箇所の分岐で切り替える。
const MODEL = 'claude-haiku-4-5';
// const ESCALATION_MODEL = 'claude-opus-4-8'; // 将来用

const EMBED_MODEL = '@cf/baai/bge-m3'; // Workers AI（1024次元・多言語）
const VECTORIZE_TOP_K = 5;
const MAX_TOKENS = 1024;
const MAX_QUESTION_LEN = 1000;

const SYSTEM_PROMPT = `あなたは中小企業の事業継続（BCP）を支援するアシスタントです。
渡された「参考情報」のみを根拠に、日本語で回答してください。
- 参考情報に無いことは断定せず、「最新の公式情報や窓口でご確認ください」と促す。
- 専門用語はかみくだき、次の一手（窓口・申請先・必要書類など）を具体的に示す。
- 災害支援は災害・時期により内容が変わる前提を一言添える。
- 回答は簡潔に。誇張や創作をしない。`;

// Vectorize に保存するチャンクのメタデータ（docs/rag-plan.md §5 と整合）
interface ChunkMeta {
  text?: string;
  source_name?: string;
  title?: string;
  url?: string;
  updated_at?: string;
  disaster_scope?: string;
}

interface SourceRef {
  source_name: string;
  title: string;
  url: string;
  updated_at?: string;
}

// Cloudflare ランタイムのバインディング（wrangler / ダッシュボードで設定）
interface RuntimeEnv {
  ANTHROPIC_API_KEY?: string;
  AI?: { run: (model: string, input: unknown) => Promise<any> };
  VECTORIZE?: { query: (vector: number[], opts: unknown) => Promise<any> };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = ((locals as any).runtime?.env ?? {}) as RuntimeEnv;

  // 1. 入力の取り出し・バリデーション
  let question = '';
  try {
    const body = (await request.json()) as { question?: unknown };
    question = String(body?.question ?? '').trim();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!question) return json({ error: 'empty_question' }, 400);
  if (question.length > MAX_QUESTION_LEN) question = question.slice(0, MAX_QUESTION_LEN);

  // バインディング未設定（未デプロイ環境）では UI のフォールバックに委ねる
  if (!env.ANTHROPIC_API_KEY || !env.AI || !env.VECTORIZE) {
    return json({ error: 'not_configured' }, 503);
  }

  try {
    // 2. 質問を埋め込み（Workers AI）
    const emb = await env.AI.run(EMBED_MODEL, { text: [question] });
    const vector: number[] = emb?.data?.[0];
    if (!vector) return json({ error: 'embedding_failed' }, 502);

    // 3. Vectorize で近傍検索
    const result = await env.VECTORIZE.query(vector, {
      topK: VECTORIZE_TOP_K,
      returnMetadata: 'all',
    });
    const matches: Array<{ metadata?: ChunkMeta }> = result?.matches ?? [];

    // 4. 参考情報・出典を組み立て
    const context = matches
      .map((m, i) => {
        const md = m.metadata ?? {};
        return `【参考情報 ${i + 1}】${md.title ?? ''}（出典：${md.source_name ?? ''}）\n${md.text ?? ''}`;
      })
      .join('\n\n');

    const seen = new Set<string>();
    const sources: SourceRef[] = [];
    let disasterScope: string | undefined;
    for (const m of matches) {
      const md = m.metadata ?? {};
      if (md.disaster_scope && md.disaster_scope !== 'general') disasterScope = md.disaster_scope;
      if (md.url && !seen.has(md.url)) {
        seen.add(md.url);
        sources.push({
          source_name: md.source_name ?? '出典',
          title: md.title ?? md.url,
          url: md.url,
          updated_at: md.updated_at,
        });
      }
    }

    // 5. Claude（Haiku）で出典に忠実な回答を生成
    const userPrompt = context
      ? `次の参考情報をもとに質問に答えてください。\n\n${context}\n\n----\n質問：${question}`
      : `参考情報は見つかりませんでした。質問：${question}\n手元に根拠が無いため、断定せず公式窓口での確認を促してください。`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!aiRes.ok) return json({ error: 'generation_failed', status: aiRes.status }, 502);
    const aiData = (await aiRes.json()) as { content?: Array<{ type: string; text?: string }> };
    const answer = (aiData.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim();

    if (!answer) return json({ error: 'empty_answer' }, 502);

    return json({
      answer,
      sources,
      fetched_at: today(),
      disaster_scope: disasterScope,
    });
  } catch (err) {
    return json({ error: 'internal_error' }, 500);
  }
};
