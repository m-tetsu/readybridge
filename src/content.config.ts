import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const categories = [
  // 平時の備え
  'bcp', 'fund-prep', 'facility-prep', 'org', 'stock',
  // 有事の対応・再建
  'wage', 'finance', 'facility', 'tax',
] as const;

const faq = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/faq' }),
  schema: z.object({
    question: z.string(),
    category: z.enum(categories),
    order: z.number().default(100),
    summary: z.string(),
    featured: z.boolean().default(false),
    sources: z
      .array(z.object({ label: z.string(), url: z.string().url() }))
      .default([]),
    updated: z.coerce.date().optional(),
  }),
});

export const collections = { faq };
