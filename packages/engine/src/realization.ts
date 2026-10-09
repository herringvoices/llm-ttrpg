import { z } from "zod";
import { stableIdSchema } from "./identity.js";
import { fictionalInstantSchema } from "./time.js";
import type { DeepReadonly, OperationWorldView } from "./operations.js";

/** A targeted, authorized need established by an action or registered operation.
 * No free-form narrator importance signal can create this request. */
export const realizationRequestSchema = z.object({
  kind: z.enum(["person-identity", "location", "entity-detail", "mechanics"]),
  sourceId: stableIdSchema,
  scopeId: stableIdSchema.optional(),
  actorId: stableIdSchema,
  fictionalTime: fictionalInstantSchema,
  trigger: z.object({
    kind: z.enum(["validated-action", "registered-operation", "meaningful-interaction", "location-entry"]),
    id: stableIdSchema,
  }).strict(),
  perspective: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("actor"), id: stableIdSchema }).strict(),
    z.object({ kind: z.literal("canonical") }).strict(),
  ]),
  required: z.array(z.string().trim().min(1)).min(1).max(8),
  targetLevel: z.enum(["ephemeral", "identified", "persistent", "minimal", "constrained", "partial", "complete"]),
  idempotencyKey: stableIdSchema,
  budget: z.object({
    maxModelCalls: z.number().int().min(0).max(1),
    maxTargets: z.literal(1),
  }).strict(),
}).strict();
export type RealizationRequest = z.infer<typeof realizationRequestSchema>;

export type PreparedRealization =
  | { readonly status: "already-sufficient" }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "operation"; readonly operationId: string; readonly input: unknown };

export interface PrepareRealizationRequest {
  readonly request: RealizationRequest;
  readonly world: DeepReadonly<OperationWorldView>;
}

/** Game/rules packages choose the authoritative implementation. The engine
 * never hardcodes stats, NPC biographies, place maps or creativity prompts. */
export type RealizationPreparer =
  (input: PrepareRealizationRequest) => PreparedRealization;

export type RealizationResult =
  | { readonly status: "already-sufficient"; readonly sourceId: string }
  | { readonly status: "unavailable"; readonly sourceId: string; readonly reason: string }
  | { readonly status: "realized"; readonly sourceId: string; readonly operationId: string;
      readonly worldRevision: number };
