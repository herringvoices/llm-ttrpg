import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LlamaCppModelRuntime } from "../apps/desktop/src/model/llama-cpp-model-runtime.js";

afterEach(() => vi.unstubAllGlobals());

describe("bundled llama.cpp model runtime", () => {
  it("maps the provider-neutral structured contract to llama.cpp and validates the result", async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "fixture-model",
        stream: false,
        reasoning_effort: "none",
        temperature: 0,
        max_tokens: 6144,
        response_format: {
          type: "json_object",
        },
        json_schema: { type: "object" },
      });
      expect(init?.headers).toEqual(expect.objectContaining({
        authorization: "Bearer secret",
      }));
      return new Response(JSON.stringify({
        model: "fixture-model",
        choices: [{ message: { role: "assistant", content: '{"choice":"investigate"}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const runtime = new LlamaCppModelRuntime({
      baseUrl: "http://127.0.0.1:8080",
      apiKey: "secret",
      model: "fixture-model",
      contextWindowTokens: 16_384,
    });
    const result = await runtime.generate({
      prompt: { instructions: ["Choose safely."], input: "What next?" },
      output: {
        kind: "structured",
        schemaId: "fixture-choice",
        schema: z.object({ choice: z.literal("investigate") }).strict(),
      },
    }, { generation: { temperature: 0, maxOutputTokens: 6_144 } });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      output: { kind: "structured", value: { choice: "investigate" } },
      metadata: expect.objectContaining({
        runtimeId: "llama.cpp",
        modelId: "fixture-model",
        usage: { inputTokens: 12, outputTokens: 4 },
      }),
    }));
    expect(runtime.capabilities).toEqual({
      structuredOutput: true,
      streamingText: false,
      contextWindowTokens: 16_384,
    });
  });

  it("normalizes an unavailable bundled service without exposing provider objects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("connection refused"); }));
    const runtime = new LlamaCppModelRuntime({
      baseUrl: "http://127.0.0.1:8080",
      apiKey: "secret",
      model: "fixture-model",
    });
    const result = await runtime.generate({
      prompt: { instructions: [], input: "Narrate." },
      output: { kind: "text" },
    });
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ kind: "runtime-unavailable" }),
      metadata: expect.objectContaining({ runtimeId: "llama.cpp" }),
    }));
  });

  it("identifies JSON truncated by the output-token ceiling", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      model: "fixture-model",
      choices: [{
        message: { role: "assistant", content: '{"choice":' },
        finish_reason: "length",
      }],
      usage: { prompt_tokens: 12, completion_tokens: 4096 },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const runtime = new LlamaCppModelRuntime({
      baseUrl: "http://127.0.0.1:8080",
      apiKey: "secret",
      model: "fixture-model",
    });
    const result = await runtime.generate({
      prompt: { instructions: [], input: "Choose." },
      output: {
        kind: "structured",
        schemaId: "fixture-choice",
        schema: z.object({ choice: z.string() }).strict(),
      },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({
        kind: "invalid-output",
        message: "The model reached its output token limit before completing the requested JSON",
      }),
    }));
  });
});
