import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { jsonValueSchema, type JsonValue } from "./json.js";
import { stableIdSchema } from "./identity.js";

export const modelConversationTurnSchema = z
  .object({
    speaker: z.enum(["user", "model"]),
    content: z.string().min(1),
  })
  .strict();
export type ModelConversationTurn = z.infer<
  typeof modelConversationTurnSchema
>;

export const modelPromptSchema = z
  .object({
    protectedContext: z.array(z.string().min(1)).optional(),
    instructions: z.array(z.string().min(1)),
    context: z.string().min(1).optional(),
    conversation: z.array(modelConversationTurnSchema).optional(),
    input: z.string().min(1),
  })
  .strict();
export type ModelPrompt = z.infer<typeof modelPromptSchema>;

export const modelTraceMetadataSchema = z
  .object({
    operation: stableIdSchema.optional(),
    invocationId: stableIdSchema.optional(),
  })
  .strict();
export type ModelTraceMetadata = z.infer<typeof modelTraceMetadataSchema>;

export const modelGenerationOptionsSchema = z
  .object({
    temperature: z.number().finite().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict();
export type ModelGenerationOptions = z.infer<
  typeof modelGenerationOptionsSchema
>;

/** Structural AbortSignal subset keeps the headless engine DOM-free. */
export interface ModelAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { readonly once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface ModelInvocationOptions {
  readonly signal?: ModelAbortSignal;
  readonly timeoutMs?: number;
  readonly generation?: ModelGenerationOptions;
}

export interface TextModelRequest {
  readonly prompt: ModelPrompt;
  readonly output: { readonly kind: "text" };
  readonly trace?: ModelTraceMetadata;
}

export interface StructuredModelOutput<T> {
  readonly kind: "structured";
  readonly schemaId: string;
  readonly schema: z.ZodType<T>;
}

export interface StructuredModelRequest<T> {
  readonly prompt: ModelPrompt;
  readonly output: StructuredModelOutput<T>;
  readonly trace?: ModelTraceMetadata;
}

export type ModelRequest<T = unknown> =
  | TextModelRequest
  | StructuredModelRequest<T>;

export const modelFailureKindSchema = z.enum([
  "cancelled",
  "timeout",
  "runtime-unavailable",
  "invalid-output",
  "capability",
  "context-too-large",
]);
export type ModelFailureKind = z.infer<typeof modelFailureKindSchema>;

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ModelResultMetadata {
  readonly runtimeId: string;
  readonly modelId?: string;
  readonly elapsedMs: number;
  readonly usage?: ModelUsage;
  readonly trace?: ModelTraceMetadata;
}

export interface ModelFailure {
  readonly ok: false;
  readonly error: {
    readonly kind: ModelFailureKind;
    readonly message: string;
    readonly diagnostic?: string;
    /** Untrusted parsed JSON may be inspected or repaired, but is never a typed success. */
    readonly candidate?: JsonValue;
  };
  readonly metadata: ModelResultMetadata;
}

export interface TextModelSuccess {
  readonly ok: true;
  readonly output: { readonly kind: "text"; readonly text: string };
  readonly metadata: ModelResultMetadata;
}

export interface StructuredModelSuccess<T> {
  readonly ok: true;
  readonly output: { readonly kind: "structured"; readonly value: T };
  readonly metadata: ModelResultMetadata;
}

export type TextModelResult = TextModelSuccess | ModelFailure;
export type StructuredModelResult<T> = StructuredModelSuccess<T> | ModelFailure;

export interface ModelRuntimeCapabilities {
  readonly structuredOutput: boolean;
  readonly streamingText: boolean;
  readonly contextWindowTokens?: number;
}

export type ModelTextStreamEvent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "complete"; readonly metadata: ModelResultMetadata }
  | { readonly kind: "failure"; readonly failure: ModelFailure };

export type ModelInvocationEvent =
  | {
      readonly kind: "started";
      readonly outputKind: "text" | "structured";
      readonly trace?: ModelTraceMetadata;
    }
  | {
      readonly kind: "completed";
      readonly outputKind: "text" | "structured";
      readonly metadata: ModelResultMetadata;
    }
  | {
      readonly kind: "failed";
      readonly outputKind: "text" | "structured";
      readonly failure: ModelFailure;
    };

export type ModelInvocationObserver = (event: ModelInvocationEvent) => void;

export interface ModelRuntime {
  readonly capabilities: ModelRuntimeCapabilities;
  generate(
    request: TextModelRequest,
    options?: ModelInvocationOptions,
  ): Promise<TextModelResult>;
  generate<T>(
    request: StructuredModelRequest<T>,
    options?: ModelInvocationOptions,
  ): Promise<StructuredModelResult<T>>;
  streamText?(
    request: TextModelRequest,
    options?: ModelInvocationOptions,
  ): AsyncIterable<ModelTextStreamEvent>;
}

export function structuredOutputJsonSchema<T>(
  output: StructuredModelOutput<T>,
): JsonValue {
  stableIdSchema.parse(output.schemaId);
  const generated = zodToJsonSchema(output.schema, {
    $refStrategy: "none",
  });
  return jsonValueSchema.parse(JSON.parse(JSON.stringify(generated)));
}

export function validateModelPrompt(prompt: ModelPrompt): ModelPrompt {
  return modelPromptSchema.parse(prompt);
}

export function validateModelInvocationOptions(
  options: ModelInvocationOptions = {},
): ModelInvocationOptions {
  if (options.timeoutMs !== undefined) {
    z.number().int().positive().parse(options.timeoutMs);
  }
  return {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.generation
      ? { generation: modelGenerationOptionsSchema.parse(options.generation) }
      : {}),
  };
}
