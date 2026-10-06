import { z } from "zod";

export const semanticActionModeSchema = z.enum([
  "movement",
  "interaction",
  "manipulation",
  "observation",
  "communication",
  "recovery",
  "power-use",
  "attack",
  "other",
]);
export type SemanticActionMode = z.infer<typeof semanticActionModeSchema>;

export const semanticActionSchema = z.object({
  modes: z.array(semanticActionModeSchema).min(1),
  statedMeans: z.array(z.string().trim().min(1)).max(8),
}).strict();
export type SemanticAction = z.infer<typeof semanticActionSchema>;
