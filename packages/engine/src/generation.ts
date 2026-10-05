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
  attemptHistory: z.array(z.object({
    attempt: z.number().int().positive(),
    issues: z.array(generationIssueSchema),
    accepted: z.boolean(),
  }).strict()).optional(),
}).strict();
export type GenerationStageDiagnostic = z.infer<
  typeof generationStageDiagnosticSchema
>;

export interface GenerationStage<TState, TCandidate> {
  readonly id: string;
  readonly maxRepairPasses?: number;
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
  options: {
    readonly maxRepairPasses?: number;
    readonly onStageAccepted?: (checkpoint: {
      readonly stageId: string;
      readonly state: TState;
      readonly diagnostic: GenerationStageDiagnostic;
    }) => Promise<void> | void;
  } = {},
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
    const stageMaxRepairPasses = stage.maxRepairPasses ?? maxRepairPasses;
    if (!Number.isInteger(stageMaxRepairPasses) || stageMaxRepairPasses < 0) {
      throw new Error(`Stage ${stage.id} maxRepairPasses must be a nonnegative integer`);
    }
    let raw = await stage.generate(state, 1);
    let candidate: unknown;
    let issues: GenerationIssue[] = [];
    let accepted = false;
    let attempts = 0;
    const attemptHistory: Array<{
      attempt: number;
      issues: GenerationIssue[];
      accepted: boolean;
    }> = [];

    for (let attempt = 1; attempt <= 1 + stageMaxRepairPasses; attempt += 1) {
      attempts = attempt;
      const parsed = stage.candidateSchema.safeParse(raw);
      if (parsed.success) {
        try {
          issues = [...(stage.validate?.(parsed.data, state) ?? [])];
        } catch (error) {
          issues = [generationIssueSchema.parse({
            code: "generation.validation-failed",
            severity: "error",
            message: error instanceof Error ? error.message : String(error),
            path: [],
            repairHint: "Repair only the invalid stage output.",
          })];
        }
      } else {
        issues = parsed.error.issues.map((issue) => generationIssueSchema.parse({
          code: "generation.schema-invalid",
          severity: "error",
          message: issue.message,
          path: issue.path,
          repairHint: "Repair only the invalid stage output.",
        }));
      }
      if (parsed.success && !issues.some((issue) => issue.severity === "error")) {
        candidate = parsed.data;
        accepted = true;
        attemptHistory.push({ attempt, issues: [...issues], accepted: true });
        break;
      }
      attemptHistory.push({ attempt, issues: [...issues], accepted: false });
      if (attempt > stageMaxRepairPasses || !stage.repair) break;
      raw = await stage.repair(
        parsed.success ? parsed.data : raw,
        issues,
        state,
        attempt + 1,
      );
    }

    const diagnostic = generationStageDiagnosticSchema.parse({
      stageId: stage.id,
      attempts,
      issues,
      accepted,
      attemptHistory,
    });
    diagnostics.push(diagnostic);
    if (!accepted) {
      const details = issues.map((issue) => {
        const path = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
        return `${issue.message}${path}`;
      }).join("; ");
      throw new GenerationStageError(
        `Generation stage ${stage.id} failed after ${attempts} attempt(s)${
          details ? `: ${details}` : ""
        }`,
        stage.id,
        issues,
      );
    }
    state = stage.accept(state, candidate);
    await options.onStageAccepted?.({
      stageId: stage.id,
      state,
      diagnostic,
    });
  }

  return { state, diagnostics };
}

export const generationRecordSchema = z.object({
  generatorVersion: z.string().trim().min(1),
  rawInput: z.string().trim().min(1),
  normalizedConstraints: jsonValueSchema,
  stageDiagnostics: z.array(generationStageDiagnosticSchema),
  acceptedStageOutputs: z.record(stableIdSchema, jsonValueSchema).optional(),
  coherenceAuditIssues: z.array(generationIssueSchema).optional(),
  controlSeed: z.number().int().nonnegative().optional(),
}).strict();
export type GenerationRecord = z.infer<typeof generationRecordSchema>;

export function jsonGenerationValue(value: unknown): JsonValue {
  return jsonValueSchema.parse(value);
}
