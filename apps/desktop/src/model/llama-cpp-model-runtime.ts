import {
  OllamaModelRuntime,
  OllamaTransportError,
  type OllamaChatRequest,
  type OllamaChatResponse,
  type OllamaTransport,
} from "./ollama-model-runtime.js";

interface OpenAiChatResponse {
  readonly model?: string;
  readonly choices?: readonly {
    readonly message?: { readonly role?: string; readonly content?: string | null };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
  readonly error?: { readonly message?: string };
}

interface OpenAiChatChunk {
  readonly model?: string;
  readonly choices?: readonly {
    readonly delta?: { readonly content?: string | null };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: OpenAiChatResponse["usage"];
  readonly error?: { readonly message?: string };
}

export interface LlamaCppModelRuntimeConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly contextWindowTokens?: number;
}

function parseResponse(value: OpenAiChatResponse): OllamaChatResponse {
  if (value.error?.message) {
    throw new OllamaTransportError("llama.cpp rejected the request", undefined, value.error.message);
  }
  const content = value.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new OllamaTransportError("llama.cpp returned no assistant message");
  }
  return {
    ...(value.model ? { model: value.model } : {}),
    message: { role: "assistant", content },
    done: true,
    ...(value.choices?.[0]?.finish_reason
      ? { done_reason: value.choices[0].finish_reason }
      : {}),
    ...(Number.isInteger(value.usage?.prompt_tokens) && value.usage!.prompt_tokens! >= 0
      ? { prompt_eval_count: value.usage!.prompt_tokens }
      : {}),
    ...(Number.isInteger(value.usage?.completion_tokens) && value.usage!.completion_tokens! >= 0
      ? { eval_count: value.usage!.completion_tokens }
      : {}),
  };
}

async function collectStream(response: Response): Promise<OllamaChatResponse> {
  if (!response.body) {
    throw new OllamaTransportError("llama.cpp returned a streaming response with no body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let model: string | undefined;
  let finishReason: string | undefined;
  let usage: OpenAiChatResponse["usage"];

  const consumeLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(":")) return;
    const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!payload || payload === "[DONE]") return;
    const chunk = JSON.parse(payload) as OpenAiChatChunk;
    if (chunk.error?.message) {
      throw new OllamaTransportError(
        "llama.cpp rejected the streaming request",
        undefined,
        chunk.error.message,
      );
    }
    if (chunk.model) model = chunk.model;
    const choice = chunk.choices?.[0];
    if (typeof choice?.delta?.content === "string") content += choice.delta.content;
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
      if (done) break;
    }
    if (buffer.trim()) consumeLine(buffer);
  } finally {
    reader.releaseLock();
  }

  return parseResponse({
    ...(model ? { model } : {}),
    choices: [{
      message: { role: "assistant", content },
      ...(finishReason ? { finish_reason: finishReason } : {}),
    }],
    ...(usage ? { usage } : {}),
  });
}

export function createLlamaCppTransport(baseUrl: string, apiKey: string): OllamaTransport {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  return {
    async chat(request: OllamaChatRequest, options): Promise<OllamaChatResponse> {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            // Keep long local generations alive at the HTTP layer. The transport
            // still buffers all chunks and exposes one non-streaming semantic result.
            stream: true,
            stream_options: { include_usage: true },
            reasoning_effort: "none",
            chat_template_kwargs: { enable_thinking: false },
            ...(request.format
              ? {
                  response_format: { type: "json_object" },
                  json_schema: request.format,
                }
              : {}),
            ...(request.options?.temperature !== undefined
              ? { temperature: request.options.temperature }
              : {}),
            ...(request.options?.num_predict !== undefined
              ? { max_tokens: request.options.num_predict }
              : {}),
          }),
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal.aborted) throw error;
        throw new OllamaTransportError(
          "Unable to reach the bundled llama.cpp service",
          undefined,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!response.ok) {
        const diagnostic = (await response.text()).slice(0, 2_000);
        throw new OllamaTransportError(
          `llama.cpp HTTP request failed with status ${response.status}`,
          response.status,
          diagnostic || undefined,
        );
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) return collectStream(response);
      return parseResponse(await response.json() as OpenAiChatResponse);
    },
    async *streamChat() {
      throw new OllamaTransportError("Streaming is disabled for the bundled llama.cpp adapter");
    },
  };
}

export class LlamaCppModelRuntime extends OllamaModelRuntime {
  constructor(config: LlamaCppModelRuntimeConfig) {
    super({
      baseUrl: config.baseUrl,
      model: config.model,
      runtimeId: "llama.cpp",
      transport: createLlamaCppTransport(config.baseUrl, config.apiKey),
      structuredOutput: true,
      streamingText: false,
      ...(config.contextWindowTokens
        ? { contextWindowTokens: config.contextWindowTokens }
        : {}),
    });
  }
}
