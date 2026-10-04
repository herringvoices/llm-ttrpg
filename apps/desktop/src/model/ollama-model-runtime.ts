import {
  modelTraceMetadataSchema,
  structuredOutputJsonSchema,
  validateModelInvocationOptions,
  validateModelPrompt,
  type ModelFailure,
  type ModelFailureKind,
  type ModelInvocationEvent,
  type ModelInvocationObserver,
  type ModelInvocationOptions,
  type ModelResultMetadata,
  type ModelRuntime,
  type ModelRuntimeCapabilities,
  type ModelTextStreamEvent,
  type StructuredModelRequest,
  type StructuredModelResult,
  type TextModelRequest,
  type TextModelResult,
} from "@llm-ttrpg/engine";

export interface OllamaChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface OllamaChatRequest {
  readonly model: string;
  readonly messages: readonly OllamaChatMessage[];
  readonly stream: boolean;
  readonly format?: unknown;
  readonly options?: {
    readonly temperature?: number;
    readonly num_predict?: number;
  };
}

export interface OllamaChatResponse {
  readonly model?: string;
  readonly message: { readonly role: string; readonly content: string };
  readonly done?: boolean;
  readonly prompt_eval_count?: number;
  readonly eval_count?: number;
}

export interface OllamaTransport {
  chat(
    request: OllamaChatRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<OllamaChatResponse>;
  streamChat(
    request: OllamaChatRequest,
    options: { readonly signal: AbortSignal },
  ): AsyncIterable<OllamaChatResponse>;
}

export class OllamaTransportError extends Error {
  override readonly name = "OllamaTransportError";

  constructor(
    message: string,
    readonly status?: number,
    readonly diagnostic?: string,
  ) {
    super(message);
  }
}

export interface OllamaModelRuntimeConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly runtimeId?: string;
  readonly structuredOutput?: boolean;
  readonly streamingText?: boolean;
  readonly contextWindowTokens?: number;
  readonly transport?: OllamaTransport;
  readonly observer?: ModelInvocationObserver;
  readonly now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResponse(value: unknown): OllamaChatResponse {
  if (!isRecord(value)) {
    throw new OllamaTransportError("Ollama returned a non-object response");
  }
  if (typeof value.error === "string") {
    throw new OllamaTransportError("Ollama rejected the request", undefined, value.error);
  }
  const message = value.message;
  if (
    !isRecord(message) ||
    typeof message.role !== "string" ||
    typeof message.content !== "string"
  ) {
    throw new OllamaTransportError("Ollama response did not contain a valid message");
  }
  return {
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    message: { role: message.role, content: message.content },
    ...(typeof value.done === "boolean" ? { done: value.done } : {}),
    ...(typeof value.prompt_eval_count === "number" &&
      Number.isInteger(value.prompt_eval_count) && value.prompt_eval_count >= 0
      ? { prompt_eval_count: value.prompt_eval_count }
      : {}),
    ...(typeof value.eval_count === "number" &&
      Number.isInteger(value.eval_count) && value.eval_count >= 0
      ? { eval_count: value.eval_count }
      : {}),
  };
}

async function errorFromResponse(response: Response): Promise<OllamaTransportError> {
  const diagnostic = (await response.text()).slice(0, 2_000);
  return new OllamaTransportError(
    `Ollama HTTP request failed with status ${response.status}`,
    response.status,
    diagnostic || undefined,
  );
}

export function createFetchOllamaTransport(baseUrl: string): OllamaTransport {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/api/chat`;
  return {
    async chat(request, options) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal.aborted) throw error;
        throw new OllamaTransportError(
          "Unable to reach the Ollama service",
          undefined,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!response.ok) throw await errorFromResponse(response);
      return parseResponse(await response.json());
    },
    async *streamChat(request, options) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal.aborted) throw error;
        throw new OllamaTransportError(
          "Unable to reach the Ollama service",
          undefined,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!response.ok) throw await errorFromResponse(response);
      if (!response.body) {
        throw new OllamaTransportError("Ollama streaming response had no body");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) yield parseResponse(JSON.parse(line));
          }
          if (done) break;
        }
        if (buffer.trim()) yield parseResponse(JSON.parse(buffer));
      } finally {
        reader.releaseLock();
      }
    },
  };
}

function systemContent(
  request: TextModelRequest | StructuredModelRequest<unknown>,
): string | undefined {
  const sections = [...request.prompt.instructions];
  if (request.prompt.context) {
    sections.push(`Authorized context:\n${request.prompt.context}`);
  }
  if (request.output.kind === "structured") {
    sections.push(
      `Return only one JSON value matching the required schema '${request.output.schemaId}'.`,
    );
  }
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

export function formatOllamaChatRequest<T>(
  model: string,
  request: TextModelRequest | StructuredModelRequest<T>,
  options: ModelInvocationOptions = {},
  stream = false,
): OllamaChatRequest {
  const prompt = validateModelPrompt(request.prompt);
  const validatedOptions = validateModelInvocationOptions(options);
  const messages: OllamaChatMessage[] = [];
  const system = systemContent(request as TextModelRequest | StructuredModelRequest<unknown>);
  if (system) messages.push({ role: "system", content: system });
  for (const turn of prompt.conversation ?? []) {
    messages.push({
      role: turn.speaker === "user" ? "user" : "assistant",
      content: turn.content,
    });
  }
  messages.push({ role: "user", content: prompt.input });
  const generation = validatedOptions.generation;
  return {
    model,
    messages,
    stream,
    ...(request.output.kind === "structured"
      ? { format: structuredOutputJsonSchema(request.output) }
      : {}),
    ...(generation
      ? {
          options: {
            ...(generation.temperature !== undefined
              ? { temperature: generation.temperature }
              : {}),
            ...(generation.maxOutputTokens !== undefined
              ? { num_predict: generation.maxOutputTokens }
              : {}),
          },
        }
      : {}),
  };
}

interface InvocationControl {
  readonly signal: AbortSignal;
  readonly reason: () => "cancelled" | "timeout" | undefined;
  readonly cleanup: () => void;
}

class InvocationAbortedError extends Error {
  override readonly name = "InvocationAbortedError";
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(new InvocationAbortedError());
  }
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new InvocationAbortedError());
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}

function invocationControl(options: ModelInvocationOptions): InvocationControl {
  const controller = new AbortController();
  let reason: "cancelled" | "timeout" | undefined;
  const cancel = () => {
    if (!reason) reason = "cancelled";
    controller.abort();
  };
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = options.timeoutMs === undefined
    ? undefined
    : setTimeout(() => {
        if (!reason) reason = "timeout";
        controller.abort();
      }, options.timeoutMs);
  return {
    signal: controller.signal,
    reason: () => reason,
    cleanup() {
      if (timeout !== undefined) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
    },
  };
}

function usage(response: OllamaChatResponse) {
  if (
    response.prompt_eval_count === undefined &&
    response.eval_count === undefined
  ) return undefined;
  return {
    ...(response.prompt_eval_count !== undefined
      ? { inputTokens: response.prompt_eval_count }
      : {}),
    ...(response.eval_count !== undefined
      ? { outputTokens: response.eval_count }
      : {}),
  };
}

function failureKind(error: unknown): ModelFailureKind {
  const diagnostic = error instanceof OllamaTransportError
    ? `${error.message} ${error.diagnostic ?? ""}`
    : error instanceof Error ? error.message : String(error);
  if (/context.{0,20}(length|window|large|exceed)|prompt.{0,20}(long|large)|num_ctx/i.test(diagnostic)) {
    return "context-too-large";
  }
  if (
    error instanceof OllamaTransportError &&
    error.status !== undefined &&
    /format|schema|structured|unsupported|not support/i.test(diagnostic)
  ) return "capability";
  return "runtime-unavailable";
}

function safeDiagnostic(error: unknown): string | undefined {
  if (error instanceof OllamaTransportError) {
    return [error.status ? `HTTP ${error.status}` : undefined, error.diagnostic]
      .filter(Boolean)
      .join(": ") || undefined;
  }
  return error instanceof Error ? error.message : undefined;
}

export class OllamaModelRuntime implements ModelRuntime {
  readonly capabilities: ModelRuntimeCapabilities;
  private readonly transport: OllamaTransport;
  private readonly now: () => number;

  constructor(private readonly config: OllamaModelRuntimeConfig) {
    if (!config.baseUrl.trim()) throw new Error("Ollama baseUrl is required");
    if (!config.model.trim()) throw new Error("Ollama model is required");
    if (
      config.contextWindowTokens !== undefined &&
      (!Number.isInteger(config.contextWindowTokens) || config.contextWindowTokens <= 0)
    ) throw new Error("contextWindowTokens must be a positive integer");
    this.capabilities = Object.freeze({
      structuredOutput: config.structuredOutput ?? true,
      streamingText: config.streamingText ?? true,
      ...(config.contextWindowTokens !== undefined
        ? { contextWindowTokens: config.contextWindowTokens }
        : {}),
    });
    this.transport = config.transport ?? createFetchOllamaTransport(config.baseUrl);
    this.now = config.now ?? Date.now;
  }

  private emit(event: ModelInvocationEvent): void {
    try {
      this.config.observer?.(event);
    } catch {
      // Diagnostics must never change invocation semantics.
    }
  }

  private metadata(
    startedAt: number,
    trace: TextModelRequest["trace"],
    response?: OllamaChatResponse,
  ): ModelResultMetadata {
    const reportedUsage = response ? usage(response) : undefined;
    return {
      runtimeId: this.config.runtimeId ?? "ollama",
      modelId: response?.model ?? this.config.model,
      elapsedMs: Math.max(0, this.now() - startedAt),
      ...(reportedUsage ? { usage: reportedUsage } : {}),
      ...(trace ? { trace: modelTraceMetadataSchema.parse(trace) } : {}),
    };
  }

  private failure(
    kind: ModelFailureKind,
    message: string,
    startedAt: number,
    trace: TextModelRequest["trace"],
    diagnostic?: string,
  ): ModelFailure {
    return {
      ok: false,
      error: { kind, message, ...(diagnostic ? { diagnostic } : {}) },
      metadata: this.metadata(startedAt, trace),
    };
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
    options: ModelInvocationOptions = {},
  ): Promise<TextModelResult | StructuredModelResult<T>> {
    const startedAt = this.now();
    const outputKind = request.output.kind;
    this.emit({
      kind: "started",
      outputKind,
      ...(request.trace ? { trace: modelTraceMetadataSchema.parse(request.trace) } : {}),
    });
    if (outputKind === "structured" && !this.capabilities.structuredOutput) {
      const failure = this.failure(
        "capability",
        "The configured runtime does not support schema-constrained structured output",
        startedAt,
        request.trace,
      );
      this.emit({ kind: "failed", outputKind, failure });
      return failure;
    }

    let validatedOptions: ModelInvocationOptions;
    let providerRequest: OllamaChatRequest;
    try {
      validatedOptions = validateModelInvocationOptions(options);
      providerRequest = formatOllamaChatRequest(
        this.config.model,
        request,
        validatedOptions,
        false,
      );
    } catch (error) {
      const failure = this.failure(
        "capability",
        "The model invocation contract is invalid",
        startedAt,
        request.trace,
        error instanceof Error ? error.message : String(error),
      );
      this.emit({ kind: "failed", outputKind, failure });
      return failure;
    }

    const control = invocationControl(validatedOptions);
    try {
      if (control.reason()) {
        const kind = control.reason()!;
        const failure = this.failure(kind, `Model invocation ${kind}`, startedAt, request.trace);
        this.emit({ kind: "failed", outputKind, failure });
        return failure;
      }
      const response = await raceWithAbort(
        this.transport.chat(providerRequest, { signal: control.signal }),
        control.signal,
      );
      if (control.reason()) {
        const kind = control.reason()!;
        const failure = this.failure(kind, `Model invocation ${kind}`, startedAt, request.trace);
        this.emit({ kind: "failed", outputKind, failure });
        return failure;
      }
      const metadata = this.metadata(startedAt, request.trace, response);
      if (request.output.kind === "text") {
        const result: TextModelResult = {
          ok: true,
          output: { kind: "text", text: response.message.content },
          metadata,
        };
        this.emit({ kind: "completed", outputKind, metadata });
        return result;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(response.message.content);
      } catch (error) {
        const failure = this.failure(
          "invalid-output",
          "The model returned malformed JSON",
          startedAt,
          request.trace,
          error instanceof Error ? error.message : String(error),
        );
        this.emit({ kind: "failed", outputKind, failure });
        return failure;
      }
      const validated = request.output.schema.safeParse(parsed);
      if (!validated.success) {
        const failure = this.failure(
          "invalid-output",
          "The model output did not satisfy the requested schema",
          startedAt,
          request.trace,
          validated.error.message,
        );
        this.emit({ kind: "failed", outputKind, failure });
        return failure;
      }
      const result: StructuredModelResult<T> = {
        ok: true,
        output: { kind: "structured", value: validated.data },
        metadata,
      };
      this.emit({ kind: "completed", outputKind, metadata });
      return result;
    } catch (error) {
      const abortReason = control.reason();
      const kind = abortReason ?? failureKind(error);
      const failure = this.failure(
        kind,
        abortReason ? `Model invocation ${abortReason}` : "The local model runtime failed",
        startedAt,
        request.trace,
        abortReason ? undefined : safeDiagnostic(error),
      );
      this.emit({ kind: "failed", outputKind, failure });
      return failure;
    } finally {
      control.cleanup();
    }
  }

  async *streamText(
    request: TextModelRequest,
    options: ModelInvocationOptions = {},
  ): AsyncIterable<ModelTextStreamEvent> {
    const startedAt = this.now();
    this.emit({
      kind: "started",
      outputKind: "text",
      ...(request.trace ? { trace: modelTraceMetadataSchema.parse(request.trace) } : {}),
    });
    if (!this.capabilities.streamingText) {
      const failure = this.failure(
        "capability",
        "The configured runtime does not support text streaming",
        startedAt,
        request.trace,
      );
      this.emit({ kind: "failed", outputKind: "text", failure });
      yield { kind: "failure", failure };
      return;
    }

    let validatedOptions: ModelInvocationOptions;
    let providerRequest: OllamaChatRequest;
    try {
      validatedOptions = validateModelInvocationOptions(options);
      providerRequest = formatOllamaChatRequest(
        this.config.model,
        request,
        validatedOptions,
        true,
      );
    } catch (error) {
      const failure = this.failure(
        "capability",
        "The model invocation contract is invalid",
        startedAt,
        request.trace,
        error instanceof Error ? error.message : String(error),
      );
      this.emit({ kind: "failed", outputKind: "text", failure });
      yield { kind: "failure", failure };
      return;
    }

    const control = invocationControl(validatedOptions);
    let finalResponse: OllamaChatResponse | undefined;
    try {
      if (control.reason()) {
        const kind = control.reason()!;
        const failure = this.failure(kind, `Model invocation ${kind}`, startedAt, request.trace);
        this.emit({ kind: "failed", outputKind: "text", failure });
        yield { kind: "failure", failure };
        return;
      }
      const stream = this.transport.streamChat(providerRequest, {
        signal: control.signal,
      });
      const iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const next = await raceWithAbort(iterator.next(), control.signal);
        if (next.done) break;
        const response = next.value;
        if (control.reason()) {
          const kind = control.reason()!;
          const failure = this.failure(kind, `Model invocation ${kind}`, startedAt, request.trace);
          this.emit({ kind: "failed", outputKind: "text", failure });
          yield { kind: "failure", failure };
          return;
        }
        finalResponse = response;
        if (response.message.content) {
          yield { kind: "text", text: response.message.content };
        }
      }
      const metadata = this.metadata(startedAt, request.trace, finalResponse);
      this.emit({ kind: "completed", outputKind: "text", metadata });
      yield { kind: "complete", metadata };
    } catch (error) {
      const abortReason = control.reason();
      const kind = abortReason ?? failureKind(error);
      const failure = this.failure(
        kind,
        abortReason ? `Model invocation ${abortReason}` : "The local model runtime failed",
        startedAt,
        request.trace,
        abortReason ? undefined : safeDiagnostic(error),
      );
      this.emit({ kind: "failed", outputKind: "text", failure });
      yield { kind: "failure", failure };
    } finally {
      control.cleanup();
    }
  }
}

export function createOllamaModelRuntime(
  config: OllamaModelRuntimeConfig,
): ModelRuntime {
  return new OllamaModelRuntime(config);
}
