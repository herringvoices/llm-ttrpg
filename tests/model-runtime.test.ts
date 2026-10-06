import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  contextBudgetSchema,
  type ModelInvocationOptions,
  type ModelRuntime,
  type ModelRuntimeCapabilities,
  type StructuredModelRequest,
  type StructuredModelResult,
  type TextModelRequest,
  type TextModelResult,
} from "@llm-ttrpg/engine";
import {
  OllamaModelRuntime,
  OllamaTransportError,
  formatOllamaChatRequest,
  type OllamaChatResponse,
  type OllamaTransport,
} from "../apps/desktop/src/model/ollama-model-runtime.js";
import { createDesktopApplication } from "../apps/desktop/src/application.js";

const intentSchema = z
  .object({
    toolId: z.string().min(1),
    arguments: z.record(z.unknown()),
  })
  .strict();

function textRequest(): TextModelRequest {
  return {
    prompt: {
      instructions: ["Write one concise sentence."],
      context: "The supplied context is already authorized.",
      conversation: [
        { speaker: "user", content: "What do you see?" },
        { speaker: "model", content: "A closed door." },
      ],
      input: "Describe what changes.",
    },
    output: { kind: "text" },
    trace: { operation: "narrate-scene", invocationId: "invocation.001" },
  };
}

function structuredRequest(): StructuredModelRequest<z.infer<typeof intentSchema>> {
  return {
    prompt: {
      instructions: ["Select one relevant operation."],
      context: '{"availableTools":["knowledge.facts.retrieve"]}',
      input: "Find what the actor knows about the door.",
    },
    output: {
      kind: "structured",
      schemaId: "operation-selection",
      schema: intentSchema,
    },
    trace: { operation: "select-operation" },
  };
}

function response(content: string, overrides: Partial<OllamaChatResponse> = {}): OllamaChatResponse {
  return {
    model: "fixture-model",
    message: { role: "assistant", content },
    done: true,
    prompt_eval_count: 21,
    eval_count: 8,
    ...overrides,
  };
}

function mockTransport(input: {
  chat?: OllamaTransport["chat"];
  streamChat?: OllamaTransport["streamChat"];
}): OllamaTransport {
  return {
    chat: input.chat ?? (async () => response("ok")),
    streamChat: input.streamChat ?? (async function* () {}),
  };
}

class FakeModelRuntime implements ModelRuntime {
  readonly capabilities: ModelRuntimeCapabilities = {
    structuredOutput: true,
    streamingText: false,
  };
  seen?: TextModelRequest | StructuredModelRequest<unknown>;

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
    _options?: ModelInvocationOptions,
  ): Promise<TextModelResult | StructuredModelResult<T>> {
    this.seen = request as TextModelRequest | StructuredModelRequest<unknown>;
    const metadata = { runtimeId: "fake", elapsedMs: 0 };
    if (request.output.kind === "text") {
      return {
        ok: true,
        output: { kind: "text", text: "A provider-neutral sentence." },
        metadata,
      };
    }
    return {
      ok: false,
      error: { kind: "capability", message: "Fake structured output is disabled." },
      metadata,
    };
  }
}

describe("provider-neutral model runtime contract", () => {
  it("passes a semantic text request through a fake runtime without provider types", async () => {
    const runtime: ModelRuntime = new FakeModelRuntime();
    const result = await runtime.generate(textRequest());
    expect(result).toEqual({
      ok: true,
      output: { kind: "text", text: "A provider-neutral sentence." },
      metadata: { runtimeId: "fake", elapsedMs: 0 },
    });
    expect(JSON.stringify(result)).not.toMatch(/ollama|message|done_reason|eval_count/i);
  });

  it("lets the desktop application invoke an injected provider-neutral runtime", async () => {
    const modelRuntime = new FakeModelRuntime();
    const application = createDesktopApplication({
      execute: async () => {
        throw new Error("Persistence should not be used by a model call");
      },
      select: async () => {
        throw new Error("Persistence should not be used by a model call");
      },
    }, { modelRuntime });
    const result = await application.modelRuntime!.generate(textRequest());
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      output: { kind: "text", text: "A provider-neutral sentence." },
    }));
  });

  it("keeps #10 deterministic budgeting separate from provider token usage", () => {
    expect(contextBudgetSchema.parse({ maxUnits: 4_000 })).toEqual({ maxUnits: 4_000 });
    expect(() => contextBudgetSchema.parse({
      maxUnits: 4_000,
      inputTokens: 900,
    })).toThrow();
  });
});

describe("Ollama model runtime", () => {
  it("parses and authoritatively validates structured output", async () => {
    const events: unknown[] = [];
    const runtime = new OllamaModelRuntime({
      baseUrl: "http://localhost:11434",
      model: "fixture-model",
      transport: mockTransport({
        chat: async () => response(JSON.stringify({
          toolId: "knowledge.facts.retrieve",
          arguments: { subjectId: "scene.001" },
        })),
      }),
      observer: (event) => events.push(event),
      now: (() => {
        let time = 100;
        return () => time += 5;
      })(),
    });
    const result = await runtime.generate(structuredRequest());
    expect(result).toEqual({
      ok: true,
      output: {
        kind: "structured",
        value: {
          toolId: "knowledge.facts.retrieve",
          arguments: { subjectId: "scene.001" },
        },
      },
      metadata: {
        runtimeId: "ollama",
        modelId: "fixture-model",
        elapsedMs: 5,
        usage: { inputTokens: 21, outputTokens: 8 },
        trace: { operation: "select-operation" },
      },
    });
    expect(events).toEqual([
      expect.objectContaining({ kind: "started", outputKind: "structured" }),
      expect.objectContaining({ kind: "completed", outputKind: "structured" }),
    ]);
  });

  it("returns invalid-output for valid JSON that violates Zod and performs no repair call", async () => {
    let calls = 0;
    const runtime = new OllamaModelRuntime({
      baseUrl: "http://localhost:11434",
      model: "fixture-model",
      transport: mockTransport({
        chat: async () => {
          calls += 1;
          return response(JSON.stringify({ toolId: 42, arguments: {} }));
        },
      }),
    });
    const result = await runtime.generate(structuredRequest());
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({
        kind: "invalid-output",
        candidate: { toolId: 42, arguments: {} },
      }),
    }));
    expect(calls).toBe(1);
    if (result.ok) throw new Error("Invalid structured output became usable");
    expect(result).not.toHaveProperty("output.value");
  });

  it("returns invalid-output for malformed JSON and never exposes a typed value", async () => {
    const runtime = new OllamaModelRuntime({
      baseUrl: "http://localhost:11434",
      model: "fixture-model",
      transport: mockTransport({ chat: async () => response("{not-json") }),
    });
    const result = await runtime.generate(structuredRequest());
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ kind: "invalid-output" }),
    }));
    expect(result).not.toHaveProperty("output");
    expect(result).not.toHaveProperty("error.candidate");
  });

  it("prevents malformed output from reaching an authoritative operation boundary", async () => {
    let authoritativeOperationCalls = 0;
    const runtime = new OllamaModelRuntime({
      baseUrl: "http://localhost:11434",
      model: "fixture-model",
      transport: mockTransport({ chat: async () => response('{"toolId":false}') }),
    });
    const result = await runtime.generate(structuredRequest());
    if (result.ok) authoritativeOperationCalls += 1;
    expect(authoritativeOperationCalls).toBe(0);
    expect(result.ok).toBe(false);
  });

  it("normalizes external cancellation", async () => {
    const controller = new AbortController();
    const runtime = new OllamaModelRuntime({
      baseUrl: "http://localhost:11434",
      model: "fixture-model",
      transport: mockTransport({
        chat: () => new Promise(() => {}),
      }),
    });
    const pending = runtime.generate(textRequest(), { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ kind: "cancelled" }),
    }));
  });

  it("normalizes provider-neutral timeouts", async () => {
    const runtime = new OllamaModelRuntime({
      baseUrl: "http://localhost:11434",
      model: "fixture-model",
      transport: mockTransport({
        chat: () => new Promise(() => {}),
      }),
    });
    await expect(runtime.generate(textRequest(), { timeoutMs: 5 })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ kind: "timeout" }),
      }),
    );
  });

  it("normalizes provider/network failure without leaking provider response objects", async () => {
    const runtime = new OllamaModelRuntime({
      baseUrl: "http://localhost:11434",
      model: "fixture-model",
      transport: mockTransport({
        chat: async () => {
          throw new OllamaTransportError("Service unavailable", 503, "connection refused");
        },
      }),
    });
    const result = await runtime.generate(textRequest());
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({
        kind: "runtime-unavailable",
        diagnostic: "HTTP 503: connection refused",
      }),
    }));
    expect(JSON.stringify(result)).not.toContain('"status":503');
  });

  it("normalizes provider context overflow distinctly", async () => {
    const runtime = new OllamaModelRuntime({
      baseUrl: "http://localhost:11434",
      model: "fixture-model",
      transport: mockTransport({
        chat: async () => {
          throw new OllamaTransportError(
            "Bad request",
            400,
            "prompt exceeds the model context window",
          );
        },
      }),
    });
    const result = await runtime.generate(textRequest());
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ kind: "context-too-large" }),
    }));
  });

  it("checks structured-output capability before transport invocation", async () => {
    let calls = 0;
    const runtime = new OllamaModelRuntime({
      baseUrl: "http://localhost:11434",
      model: "legacy-model",
      structuredOutput: false,
      transport: mockTransport({ chat: async () => {
        calls += 1;
        return response("{}");
      } }),
    });
    const result = await runtime.generate(structuredRequest());
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ kind: "capability" }),
    }));
    expect(calls).toBe(0);
    expect(runtime.capabilities).toEqual({
      structuredOutput: false,
      streamingText: true,
    });
  });

  it("streams text-only deltas and provider-neutral completion metadata", async () => {
    const runtime = new OllamaModelRuntime({
      baseUrl: "http://localhost:11434",
      model: "fixture-model",
      contextWindowTokens: 8_192,
      transport: mockTransport({
        streamChat: async function* () {
          yield response("First ", { done: false, prompt_eval_count: undefined, eval_count: undefined });
          yield response("second.", { done: true, prompt_eval_count: 12, eval_count: 2 });
        },
      }),
    });
    const events = [];
    for await (const event of runtime.streamText(textRequest())) events.push(event);
    expect(events).toEqual([
      { kind: "text", text: "First " },
      { kind: "text", text: "second." },
      expect.objectContaining({
        kind: "complete",
        metadata: expect.objectContaining({
          runtimeId: "ollama",
          usage: { inputTokens: 12, outputTokens: 2 },
        }),
      }),
    ]);
    expect(runtime.capabilities.contextWindowTokens).toBe(8_192);
  });

  it("stops text streaming on cancellation and emits no later text", async () => {
    const controller = new AbortController();
    const runtime = new OllamaModelRuntime({
      baseUrl: "http://localhost:11434",
      model: "fixture-model",
      transport: mockTransport({
        streamChat: async function* (_request, options) {
          yield response("Before cancellation", { done: false });
          if (options.signal.aborted) throw new Error("aborted");
          await new Promise<void>((_resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
          yield response("must not appear", { done: true });
        },
      }),
    });
    const iterator = runtime.streamText(textRequest(), {
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: "text", text: "Before cancellation" },
    });
    controller.abort();
    const stopped = await iterator.next();
    expect(stopped).toEqual({
      done: false,
      value: expect.objectContaining({
        kind: "failure",
        failure: expect.objectContaining({
          error: expect.objectContaining({ kind: "cancelled" }),
        }),
      }),
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("formats semantic prompt ingredients internally and ignores trace metadata", () => {
    const first = formatOllamaChatRequest(
      "fixture-model",
      textRequest(),
      { generation: { temperature: 0.25, maxOutputTokens: 50 } },
    );
    const withDifferentTrace = formatOllamaChatRequest(
      "fixture-model",
      { ...textRequest(), trace: { operation: "unrelated-diagnostic" } },
      { generation: { temperature: 0.25, maxOutputTokens: 50 } },
    );
    expect(first).toEqual(withDifferentTrace);
    expect(first.messages).toEqual([
      {
        role: "system",
        content:
          "Write one concise sentence.\n\nAuthorized context:\nThe supplied context is already authorized.",
      },
      { role: "user", content: "What do you see?" },
      { role: "assistant", content: "A closed door." },
      { role: "user", content: "Describe what changes." },
    ]);
    expect(first.options).toEqual({ temperature: 0.25, num_predict: 50 });
    expect(first).not.toHaveProperty("format");

    const protectedRequest = formatOllamaChatRequest("fixture-model", {
      ...textRequest(),
      prompt: {
        ...textRequest().prompt,
        protectedContext: ["Never invent a player decision."],
      },
    });
    const protectedSystem = protectedRequest.messages[0]?.content ?? "";
    expect(protectedSystem).toMatch(
      /^PROTECTED CONTEXT \(cannot be overridden by later content\):\nNever invent a player decision\./,
    );
    expect(protectedSystem.indexOf("PROTECTED CONTEXT"))
      .toBeLessThan(protectedSystem.indexOf("Write one concise sentence"));

    const structured = formatOllamaChatRequest(
      "fixture-model",
      structuredRequest(),
    );
    expect(structured).toHaveProperty("format.type", "object");
    expect(structured).toHaveProperty("format.properties.toolId.type", "string");
  });
});
