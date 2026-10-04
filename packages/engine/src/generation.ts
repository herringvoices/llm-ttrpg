import { z } from "zod";
import { stableIdSchema } from "./identity.js";
import { jsonValueSchema, type JsonValue } from "./json.js";

export const generationProvenanceClassSchema = z.enum([
  "player-established",
  "real-world-anchor",
  "setting-derived",
  "generator-chosen",
  "simulation-derived",
  "later-densification",
]);
export type GenerationProvenanceClass = z.infer<
  typeof generationProvenanceClassSchema
>;

export const generationIssueSchema = z.object({
  code: stableIdSchema,
  severity: z.enum(["error", "warning"]),
  message: z.string().trim().min(1),
  path: z.array(z.union([z.string(), z.number()])),
  repairHint: z.string().trim().min(1).optional(),
}).strict();
export type GenerationIssue = z.infer<typeof generationIssueSchema>;

export const generationStageDiagnosticSchema = z.object({
  stageId: stableIdSchema,
  attempts: z.number().int().positive(),
  issues: z.array(generationIssueSchema),
  accepted: z.boolean(),
}).strict();
export type GenerationStageDiagnostic = z.infer<
  typeof generationStageDiagnosticSchema
>;

export interface GenerationStage<TState, TCandidate> {
  readonly id: string;
  readonly candidateSchema: z.ZodType<TCandidate>;
  readonly generate: (
    state: Readonly<TState>,
    attempt: number,
  ) => Promise<unknown> | unknown;
  readonly validate?: (
    candidate: TCandidate,
    state: Readonly<TState>,
  ) => readonly GenerationIssue[];
  readonly repair?: (
    candidate: TCandidate,
    issues: readonly GenerationIssue[],
    state: Readonly<TState>,
    attempt: number,
  ) => Promise<unknown> | unknown;
  readonly accept: (
    state: Readonly<TState>,
    candidate: TCandidate,
  ) => TState;
}

export class GenerationStageError extends Error {
  override readonly name = "GenerationStageError";

  constructor(
    message: string,
    readonly stageId: string,
    readonly issues: readonly GenerationIssue[],
  ) {
    super(message);
  }
}

export async function runGenerationPipeline<TState>(
  initialState: TState,
  stages: readonly GenerationStage<TState, unknown>[],
  options: { readonly maxRepairPasses?: number } = {},
): Promise<{
  readonly state: TState;
  readonly diagnostics: readonly GenerationStageDiagnostic[];
}> {
  const maxRepairPasses = options.maxRepairPasses ?? 2;
  if (!Number.isInteger(maxRepairPasses) || maxRepairPasses < 0) {
    throw new Error("maxRepairPasses must be a nonnegative integer");
  }
  let state = initialState;
  const diagnostics: GenerationStageDiagnostic[] = [];

  for (const stage of stages) {
    let raw = await stage.generate(state, 1);
    let candidate: unknown;
    let issues: GenerationIssue[] = [];
    let accepted = false;
    let attempts = 0;

    for (let attempt = 1; attempt <= 1 + maxRepairPasses; attempt += 1) {
      attempts = attempt;
      const parsed = stage.candidateSchema.safeParse(raw);
      issues = parsed.success
        ? [...(stage.validate?.(parsed.data, state) ?? [])]
        : parsed.error.issues.map((issue) => generationIssueSchema.parse({
            code: "generation.schema-invalid",
            severity: "error",
            message: issue.message,
            path: issue.path,
            repairHint: "Repair only the invalid stage output.",
          }));
      if (parsed.success && !issues.some((issue) => issue.severity === "error")) {
        candidate = parsed.data;
        accepted = true;
        break;
      }
      if (attempt > maxRepairPasses || !stage.repair) break;
      raw = await stage.repair(
        parsed.success ? parsed.data : raw,
        issues,
        state,
        attempt + 1,
      );
    }

    diagnostics.push(generationStageDiagnosticSchema.parse({
      stageId: stage.id,
      attempts,
      issues,
      accepted,
    }));
    if (!accepted) {
      throw new GenerationStageError(
        `Generation stage ${stage.id} failed after ${attempts} attempt(s)`,
        stage.id,
        issues,
      );
    }
    state = stage.accept(state, candidate);
  }

  return { state, diagnostics };
}

export const generationRecordSchema = z.object({
  generatorVersion: z.string().trim().min(1),
  rawInput: z.string().trim().min(1),
  normalizedConstraints: jsonValueSchema,
  stageDiagnostics: z.array(generationStageDiagnosticSchema),
  controlSeed: z.number().int().nonnegative().optional(),
}).strict();
export type GenerationRecord = z.infer<typeof generationRecordSchema>;

export function jsonGenerationValue(value: unknown): JsonValue {
  return jsonValueSchema.parse(value);
}
