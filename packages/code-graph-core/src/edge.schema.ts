import { z } from 'zod';

export const EdgeType = z.enum([
  'contains',
  'imports',
  'calls',
  'depends-on',
  'renders',
  'references',
]);
export type EdgeType = z.infer<typeof EdgeType>;

export const GraphEdge = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: EdgeType,
  weight: z.number().positive().default(1),
});
export type GraphEdge = z.infer<typeof GraphEdge>;
