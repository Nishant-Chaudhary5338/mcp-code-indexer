import { z } from 'zod';

export const NodeKnowledge = z.object({
  summary: z.string(),
  tags: z.array(z.string()),
  embeddingId: z.string().nullable(),
  generatedAt: z.number(),
  model: z.string(),
});
export type NodeKnowledge = z.infer<typeof NodeKnowledge>;

export const GitMeta = z.object({
  lastChanged: z.number().nullable(),
  churn: z.number().int().nonnegative(),
  authors: z.array(z.string()),
});
export type GitMeta = z.infer<typeof GitMeta>;
