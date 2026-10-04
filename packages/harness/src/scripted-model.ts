import {
  type JsonValue,
  type ModelFailureKind,
  type ModelInvocationOptions,
  type ModelRequest,
  type ModelResultMetadata,
  type ModelRuntime,
  type ModelRuntimeCapabilities,
  type StructuredModelRequest,
  type StructuredModelResult,
  type TextModelRequest,
  type TextModelResult,
} from "@llm-ttrpg/engine";

export interface ScriptedModelMatch {
  readonly outputKind?: "text" | "structured";
  readonly operation?: string;
  readonly schemaId?: string;
  readonly invocationId?: string;
  readonly predicate?: (request: ModelRequest<unknown>) => boolean;
}

export type ScriptedModelResult =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "structured"; readonly value: unknown }
  | {
      readonly kind: "failure";
      readonly failureKind: ModelFailureKind;
      readonly message: string;
      readonly diagnostic?: string;
    }
  | { readonly kind: "schema-invalid"; readonly value: unknown };

export interface ScriptedModelStep {
  readonly id: string;
  readonly match?: ScriptedModelMatch;
  readonly result: ScriptedModelResult | (
    (request: ModelRequest<unknown>) => ScriptedModelResult
  );
  readonly repeat?: boolean;
}

export interface ScriptedModelInvocation {
  readonly sequence: number;
  readonly outputKind: "text" | "structured";
  readonly operation?: string;
  readonly schemaId?: string;
  readonly invocationId?: string;
  readonly matchedStepId?: string;
  readonly result: "success" | "failure" | "unmatched";
  readonly diagnostic?: JsonValue;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function matches(step: ScriptedModelStep, request: ModelRequest<unknown>): boolean {
  const match = step.match;
  if (!match) return true;
  if (match.outputKind && match.outputKind !== request.output.kind) return false;
  if (match.operation && match.operation !== request.trace?.operation) return false;
  if (match.invocationId && match.invocationId !== request.trace?.invocationId) {
    return false;
  }
  if (
    match.schemaId &&
    (request.output.kind !== "structured" || request.output.schemaId !== match.schemaId)
  ) return false;
  return match.predicate?.(request) ?? true;
}

export class ScriptedModelRuntime implements ModelRuntime {
  readonly capabilities: ModelRuntimeCapabilities = {
    structuredOutput: true,
    streamingText: false,
  };
  readonly invocations: ScriptedModelInvocation[] = [];
  private readonly remaining: ScriptedModelStep[];

  constructor(readonly steps: readonly ScriptedModelStep[]) {
    this.remaining = [...steps];
  }

  reset(): void {
    this.remaining.splice(0, this.remaining.length, ...this.steps);
    this.invocations.splice(0);
  }

  generate(
    request: TextModelRequest,
    options?: ModelInvocationOptions,
  ): Promise<TextModelResult>;
  generate<T>(
    request: StructuredModelRequest<T>,
    options?: ModelInvocationOptions,
  ): Promise<StructuredModelResult<T>>;
  async generate<T>(
    request: TextModelRequest | StructuredModelRequest<T>,
    options?: ModelInvocationOptions,
  ): Promise<TextModelResult | StructuredModelResult<T>> {
    const sequence = this.invocations.length + 1;
    const metadata: ModelResultMetadata = {
      runtimeId: "harness-scripted-model",
      elapsedMs: 0,
      ...(request.trace ? { trace: clone(request.trace) } : {}),
    };
    if (options?.signal?.aborted) {
      this.invocations.push({
        sequence,
        outputKind: request.output.kind,
        ...(request.trace?.operation ? { operation: request.trace.operation } : {}),
        ...(request.trace?.invocationId ? { invocationId: request.trace.invocationId } : {}),
        ...(request.output.kind === "structured"
          ? { schemaId: request.output.schemaId }
          : {}),
        result: "failure",
        diagnostic: { kind: "cancelled-before-invocation" },
      });
      return {
        ok: false,
        error: { kind: "cancelled", message: "Scripted invocation was cancelled" },
        metadata,
      };
    }
    const index = this.remaining.findIndex((step) => matches(
      step,
      request as ModelRequest<unknown>,
    ));
    const step = index === -1 ? undefined : this.remaining[index];
    if (step && !step.repeat) this.remaining.splice(index, 1);
    const base = {
      sequence,
      outputKind: request.output.kind,
      ...(request.trace?.operation ? { operation: request.trace.operation } : {}),
      ...(request.trace?.invocationId ? { invocationId: request.trace.invocationId } : {}),
      ...(request.output.kind === "structured"
        ? { schemaId: request.output.schemaId }
        : {}),
      ...(step ? { matchedStepId: step.id } : {}),
    };
    if (!step) {
      this.invocations.push({ ...base, result: "unmatched" });
      return {
        ok: false,
        error: {
          kind: "runtime-unavailable",
          message: "No scripted model step matched this invocation",
        },
        metadata,
      };
    }
    const stepResult = typeof step.result === "function"
      ? step.result(request as ModelRequest<unknown>)
      : step.result;
    if (stepResult.kind === "failure") {
      this.invocations.push({
        ...base,
        result: "failure",
        diagnostic: {
          kind: stepResult.failureKind,
          message: stepResult.message,
        },
      });
      return {
        ok: false,
        error: {
          kind: stepResult.failureKind,
          message: stepResult.message,
          ...(stepResult.diagnostic
            ? { diagnostic: stepResult.diagnostic }
            : {}),
        },
        metadata,
      };
    }
    if (request.output.kind === "text") {
      if (stepResult.kind !== "text") {
        this.invocations.push({ ...base, result: "failure" });
        return {
          ok: false,
          error: {
            kind: "invalid-output",
            message: `Script step ${step.id} did not provide text`,
          },
          metadata,
        };
      }
      this.invocations.push({ ...base, result: "success" });
      return {
        ok: true,
        output: { kind: "text", text: stepResult.text },
        metadata,
      };
    }
    if (stepResult.kind === "schema-invalid") {
      const parsed = request.output.schema.safeParse(stepResult.value);
      this.invocations.push({
        ...base,
        result: "failure",
        diagnostic: {
          kind: "schema-invalid",
          issues: parsed.success ? [] : parsed.error.issues.map((issue) => issue.message),
        },
      });
      return {
        ok: false,
        error: {
          kind: "invalid-output",
          message: `Script step ${step.id} intentionally returned schema-invalid data`,
        },
        metadata,
      };
    }
    if (stepResult.kind !== "structured") {
      this.invocations.push({ ...base, result: "failure" });
      return {
        ok: false,
        error: {
          kind: "invalid-output",
          message: `Script step ${step.id} did not provide structured output`,
        },
        metadata,
      };
    }
    const parsed = request.output.schema.safeParse(stepResult.value);
    if (!parsed.success) {
      this.invocations.push({
        ...base,
        result: "failure",
        diagnostic: {
          kind: "schema-invalid",
          issues: parsed.error.issues.map((issue) => issue.message),
        },
      });
      return {
        ok: false,
        error: {
          kind: "invalid-output",
          message: `Script step ${step.id} failed the authoritative output schema`,
          diagnostic: parsed.error.message,
        },
        metadata,
      };
    }
    this.invocations.push({ ...base, result: "success" });
    return {
      ok: true,
      output: { kind: "structured", value: parsed.data },
      metadata,
    };
  }
}

export function scriptedModel(
  steps: readonly ScriptedModelStep[],
): ScriptedModelRuntime {
  return new ScriptedModelRuntime(steps);
}
