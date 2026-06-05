import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { CATEGORIES, PILLARS, type CategoryKey, type PillarKey } from '../categories';

export const GET: APIRoute = async () => {
  const faqs = await getCollection('faq');
  const items = faqs.map((f) => {
    const cat = CATEGORIES[f.data.category as CategoryKey];
    const pillar = cat.pillar as PillarKey;
    return {
      id: f.id,
      url: `/faq/${f.id}`,
      question: f.data.question,
      summary: f.data.summary,
      category: f.data.category,
      categoryLabel: cat.label,
      pillar,
      pillarLabel: PILLARS[pillar].short,
    };
  });
  return new Response(JSON.stringify(items), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
