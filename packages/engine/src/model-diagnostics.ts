import type {
  ModelFailure,
  ModelInvocationOptions,
  ModelRequest,
  ModelResultMetadata,
  ModelRuntime,
  ModelTextStreamEvent,
  StructuredModelRequest,
  StructuredModelResult,
  TextModelRequest,
  TextModelResult,
} from "./model-runtime.js";

/** Safe-to-export measurements: never holds prompt, completion, candidate or error text. */
export interface ModelCallDiagnostic {
  readonly phase: string;
  readonly operation?: string;
  readonly schemaId?: string;
  readonly outputKind: "text" | "structured";
  readonly promptCharacters: number;
  readonly elapsedWallMs: number;
  readonly elapsedProviderMs?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly status: "ok" | "failed" | "threw";
  readonly failureKind?: string;
}

function clock(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function safePromptLength(request: ModelRequest): number {
  try {
    return JSON.stringify(request.prompt).length;
  } catch {
    return 0;
  }
}

/**
 * Transparently observes a runtime for the lifetime of a desktop session.
 * The callback must never be able to change model results, throwing behavior,
 * stream ordering, or cancellation semantics. No model content is retained.
 */
export function observeModelRuntime(
  runtime: ModelRuntime,
  onCall: (call: ModelCallDiagnostic) => void,
  currentPhase: () => string = () => "unspecified",
): ModelRuntime {
  function safelyReport(
    request: ModelRequest,
    phase: string,
    started: number,
    status: ModelCallDiagnostic["status"],
    metadata?: ModelResultMetadata,
    failure?: ModelFailure,
  ): void {
    try {
      const providerMs = safeNumber(metadata?.elapsedMs);
      const inputTokens = safeNumber(metadata?.usage?.inputTokens);
      const outputTokens = safeNumber(metadata?.usage?.outputTokens);
      onCall({
        phase,
        ...(request.trace?.operation ? { operation: request.trace.operation } : {}),
        ...(request.output.kind === "structured"
          ? { schemaId: request.output.schemaId }
          : {}),
        outputKind: request.output.kind,
        promptCharacters: safePromptLength(request),
        elapsedWallMs: Math.max(0, clock() - started),
        ...(providerMs !== undefined ? { elapsedProviderMs: providerMs } : {}),
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        status,
        ...(failure ? { failureKind: failure.error.kind } : {}),
        ...(status === "threw" ? { failureKind: "exception" } : {}),
      });
    } catch {
      // Diagnostics, including a broken observer or malformed provider metadata,
      // are never allowed to interfere with authoritative execution.
    }
  }

  function phaseAtStart(): string {
    try {
      return currentPhase();
    } catch {
      return "unspecified";
    }
  }

  function generate(
    request: TextModelRequest,
    options?: ModelInvocationOptions,
  ): Promise<TextModelResult>;
  function generate<T>(
    request: StructuredModelRequest<T>,
    options?: ModelInvocationOptions,
  ): Promise<StructuredModelResult<T>>;
  async function generate<T>(
    request: TextModelRequest | StructuredModelRequest<T>,
    options?: ModelInvocationOptions,
  ): Promise<TextModelResult | StructuredModelResult<T>> {
    const started = clock();
    const phase = phaseAtStart();
    try {
      const result = request.output.kind === "text"
        ? await runtime.generate(request, options)
        : await runtime.generate(request, options);
      safelyReport(
        request,
        phase,
        started,
        result.ok ? "ok" : "failed",
        result.metadata,
        result.ok ? undefined : result,
      );
      return result;
    } catch (error) {
      safelyReport(request, phase, started, "threw");
      throw error;
    }
  }

  const streamText = runtime.streamText
    ? async function* (
        request: TextModelRequest,
        options?: ModelInvocationOptions,
      ): AsyncIterable<ModelTextStreamEvent> {
        const started = clock();
        const phase = phaseAtStart();
        let status: ModelCallDiagnostic["status"] = "failed";
        let metadata: ModelResultMetadata | undefined;
        let failure: ModelFailure | undefined;
        try {
          for await (const event of runtime.streamText!(request, options)) {
            if (event.kind === "complete") {
              status = "ok";
              metadata = event.metadata;
            } else if (event.kind === "failure") {
              status = "failed";
              failure = event.failure;
              metadata = event.failure.metadata;
            }
            yield event;
          }
        } catch (error) {
          status = "threw";
          throw error;
        } finally {
          // A prematurely closed stream is recorded as failed, exactly once.
          safelyReport(request, phase, started, status, metadata, failure);
        }
      }
    : undefined;

  return {
    capabilities: runtime.capabilities,
    generate,
    ...(streamText ? { streamText } : {}),
  };
}
