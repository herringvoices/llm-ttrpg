import { z } from "zod";
import { actionPressureLevelSchema } from "./action-pressure.js";
import { stableIdSchema } from "./identity.js";
import { semanticActionModeSchema } from "./semantic-action.js";
import { fictionalDurationMsSchema } from "./time.js";
import { prepareModelBrief, resolveBriefReference } from "./model-brief.js";
import type { ContextPackage } from "./context-contracts.js";
import type { ModelRuntime } from "./model-runtime.js";

export const turnActionSegmentSchema = z.object({
  kind: z.literal("action"),
  text: z.string().trim().min(1).optional(),
  goal: z.string().trim().min(1),
  modes: z.array(semanticActionModeSchema).min(1),
  targetRefs: z.array(stableIdSchema),
  statedMeans: z.array(z.string().trim().min(1)).max(8),
  pressureLevel: actionPressureLevelSchema,
  requestedHorizonMs: fictionalDurationMsSchema,
}).strict();

export const turnCommunicationSegmentSchema = z.object({
  kind: z.literal("communication"),
  text: z.string().trim().min(1).optional(),
  recipientRefs: z.array(stableIdSchema).min(1),
  utterance: z.string().min(1).optional(),
}).strict();

export const interpretedTurnSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("interpreted"),
    segments: z.array(z.discriminatedUnion("kind", [
      turnActionSegmentSchema, turnCommunicationSegmentSchema,
    ])).min(1),
  }).strict(),
  z.object({
    kind: z.literal("player-decision-required"),
    question: z.string().trim().min(1),
  }).strict(),
]);
export type InterpretedTurnDecision = z.infer<typeof interpretedTurnSchema>;

export type ResolvedTurnSegment =
  | {
      readonly kind: "action";
      readonly text: string;
      readonly goal: string;
      readonly modes: z.infer<typeof semanticActionModeSchema>[];
      readonly targetIds: readonly string[];
      readonly statedMeans: readonly string[];
      readonly pressureLevel: z.infer<typeof actionPressureLevelSchema>;
      readonly requestedHorizonMs: number;
    }
  | {
      readonly kind: "communication";
      readonly text: string;
      readonly recipientIds: readonly string[];
      readonly utterance?: string;
    };

export type ClassifiedTurn =
  | {
      readonly kind: "interpreted";
      readonly originalDeclaration: string;
      readonly segments: readonly ResolvedTurnSegment[];
      readonly worldRevision: number;
      readonly eventSequence: number;
      readonly source: "model" | "deterministic";
    }
  | { readonly kind: "player-decision-required"; readonly question: string };

function segmentText(
  original: string,
  text: string | undefined,
  count: number,
  previousEnd: number,
): { text: string; end: number } {
  if (!text && count > 1) throw new Error("Ordered segments must quote their portion of the declaration");
  const actual = text ?? original;
  const start = original.indexOf(actual, previousEnd);
  if (start < 0) throw new Error("The classified segment does not occur in the submitted declaration");
  return { text: actual, end: start + actual.length };
}

function exactQuote(original: string, utterance: string): boolean {
  return [`"${utterance}"`, `“${utterance}”`, `'${utterance}'`].some((quoted) =>
    original.includes(quoted)
  );
}

/** Only an objectively unambiguous observation with *already assessed* pressure
 * avoids the model. No keyword router silently guesses at creative commands. */
export function deterministicTurnClassification(
  declaration: string,
  context: ContextPackage,
): ClassifiedTurn | undefined {
  if (!/^I (?:look around|take a look around)\.?$/i.test(declaration.trim())) return undefined;
  const pressure = context.situation.actionPressure;
  if (!pressure || typeof pressure !== "object" || pressure.status !== "assessed" ||
      typeof pressure.level !== "number") return undefined;
  return {
    kind: "interpreted",
    originalDeclaration: declaration,
    worldRevision: context.diagnostics.worldRevision,
    eventSequence: context.diagnostics.eventSequence ?? 0,
    source: "deterministic",
    segments: [{
      kind: "action",
      text: declaration,
      goal: "Observe the immediately visible surroundings",
      modes: ["observation"],
      targetIds: [],
      statedMeans: [],
      pressureLevel: actionPressureLevelSchema.parse(pressure.level),
      requestedHorizonMs: Math.min(10_000, typeof pressure.maximumResolutionHorizonMs === "number"
        ? pressure.maximumResolutionHorizonMs : 10_000),
    }],
  };
}

/**
 * One compact initial model classification for ordinary declarations.
 * Canonical targets remain engine-only; a forged/stale reference gets one
 * bounded corrective retry, never a speculative world mutation.
 */
export async function classifyTurnDeclaration(input: {
  readonly declaration: string;
  readonly actorId: string;
  readonly context: ContextPackage;
  readonly modelRuntime: ModelRuntime;
  readonly worldRevision: number;
  readonly eventSequence: number;
}): Promise<ClassifiedTurn> {
  if (input.context.diagnostics.worldRevision !== input.worldRevision ||
      input.context.diagnostics.eventSequence !== input.eventSequence) {
    throw new Error("Declaration context is stale");
  }
  const fast = deterministicTurnClassification(input.declaration, input.context);
  if (fast) return fast;
  const brief = prepareModelBrief({
    purpose: "action-interpretation",
    perspective: { kind: "actor", id: input.actorId },
    context: input.context,
  });
  const instructions = [
    "Classify the whole player declaration once into ordered action or communication segments.",
    "Keep movement/action before speech if the declaration says first/then/before. Do not add steps or invent results.",
    "Use only authorized scene.### references for targets or recipients; do not use canonical IDs.",
    "Keep stated action means and semantic modes exactly relevant. Modes: movement, interaction, manipulation, observation, communication, recovery, power-use, attack, other.",
    "Assess pressure 1 (loose) through 9 (immediate), and requested fictional horizon for each action. The engine will bound the horizon.",
    "For multiple segments, copy the exact original substring to each text. For a single segment, text may be omitted.",
    "Preserve explicitly quoted player speech exactly in utterance; never paraphrase it.",
    "Only request a decision for genuinely material ambiguity; infer minor implementation details from the visible scene.",
    "Unknown creative actions are still valid actions, not automatic routine success.",
  ];
  let lastError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await input.modelRuntime.generate({
      prompt: {
        instructions: lastError
          ? [...instructions, "The previous attempt was rejected for invalid local references, fidelity, or ordering. Correct the classification without inventing new information."]
          : instructions,
        context: brief.modelText,
        input: input.declaration,
      },
      output: { kind: "structured", schemaId: "turn.declaration.v1", schema: interpretedTurnSchema },
      trace: { operation: "turn.declaration.v1" },
    });
    if (!result.ok) {
      if (result.error.kind !== "invalid-output" || attempt === 1) {
        throw new Error(`Unable to classify declaration: ${result.error.kind}`);
      }
      lastError = result.error.kind;
      continue;
    }
    if (result.output.value.kind === "player-decision-required") {
      return result.output.value;
    }
    try {
      let offset = 0;
      const segments: ResolvedTurnSegment[] = [];
      for (const segment of result.output.value.segments) {
        const found = segmentText(
          input.declaration, segment.text, result.output.value.segments.length, offset,
        );
        offset = found.end;
        if (segment.kind === "action") {
          segments.push({
            kind: "action", text: found.text, goal: segment.goal,
            modes: segment.modes, statedMeans: segment.statedMeans,
            requestedHorizonMs: segment.requestedHorizonMs,
            pressureLevel: segment.pressureLevel,
            targetIds: segment.targetRefs.map((ref) =>
              resolveBriefReference(brief, ref, {
                worldRevision: input.worldRevision, eventSequence: input.eventSequence,
              })),
          });
        } else {
          if (segment.utterance && !exactQuote(input.declaration, segment.utterance)) {
            throw new Error("A quoted utterance was not copied verbatim");
          }
          segments.push({
            kind: "communication", text: found.text,
            recipientIds: segment.recipientRefs.map((ref) =>
              resolveBriefReference(brief, ref, {
                worldRevision: input.worldRevision, eventSequence: input.eventSequence,
              })),
            ...(segment.utterance ? { utterance: segment.utterance } : {}),
          });
        }
      }
      return {
        kind: "interpreted",
        originalDeclaration: input.declaration,
        segments,
        worldRevision: input.worldRevision,
        eventSequence: input.eventSequence,
        source: "model",
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Invalid classified segment";
    }
  }
  throw new Error("The declaration could not be classified without invalid or stale references");
}
