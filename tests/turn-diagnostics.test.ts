import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  observeModelRuntime,
  type ModelCallDiagnostic,
  type ModelRuntime,
  type TextModelRequest,
} from "@llm-ttrpg/engine";
import { ScriptedModelRuntime } from "@llm-ttrpg/harness";

const secret = "GM_ONLY_SECRET_DO_NOT_EXPORT";
const textRequest: TextModelRequest = {
  prompt: { instructions: ["Use the private prompt safely."], context: secret, input: "Describe the room." },
  output: { kind: "text" },
  trace: { operation: "player-action.narration.v1" },
};

describe("LM-01 model diagnostics", () => {
  it("records each success, provider failure and retry once without retaining private material", async () => {
    const calls: ModelCallDiagnostic[] = [];
    const underlying = new ScriptedModelRuntime([
      { id: "invalid", match: { schemaId: "test.response.v1" },
        result: { kind: "schema-invalid", value: { wrong: secret } } },
      { id: "repaired", match: { schemaId: "test.response.v1" },
        result: { kind: "structured", value: { answer: "yes" } } },
      { id: "narration", match: { operation: "player-action.narration.v1" },
        result: { kind: "text", text: "The room is quiet." } },
    ]);
    const wrapped = observeModelRuntime(underlying, (call) => calls.push(call), () => "understanding");
    const request = {
      prompt: { instructions: ["Answer"], input: secret },
      output: {
        kind: "structured" as const,
        schemaId: "test.response.v1",
        schema: z.object({ answer: z.string() }).strict(),
      },
      trace: { operation: "retry-structured" },
    };
    expect((await wrapped.generate(request)).ok).toBe(false);
    expect((await wrapped.generate(request)).ok).toBe(true);
    expect((await wrapped.generate(textRequest)).ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.status)).toEqual(["failed", "ok", "ok"]);
    expect(calls[0]).toEqual(expect.objectContaining({
      schemaId: "test.response.v1",
      failureKind: "invalid-output",
      phase: "understanding",
    }));
    expect(calls[2]).toEqual(expect.objectContaining({
      outputKind: "text",
      operation: "player-action.narration.v1",
      promptCharacters: expect.any(Number),
    }));
    expect(calls.every((call) => call.inputTokens === undefined)).toBe(true);
    expect(JSON.stringify(calls)).not.toContain(secret);
    expect(JSON.stringify(calls)).not.toContain("The room is quiet");
  });

  it("observes thrown providers without swallowing the original exception or observer errors", async () => {
    const calls: ModelCallDiagnostic[] = [];
    const providerError = new Error(secret);
    const throwing: ModelRuntime = {
      capabilities: { structuredOutput: true, streamingText: false },
      generate: (async () => { throw providerError; }) as ModelRuntime["generate"],
    };
    const wrapped = observeModelRuntime(throwing, (call) => calls.push(call));
    await expect(wrapped.generate(textRequest)).rejects.toBe(providerError);
    expect(calls).toEqual([expect.objectContaining({ status: "threw", failureKind: "exception" })]);
    expect(JSON.stringify(calls)).not.toContain(secret);

    const working = new ScriptedModelRuntime([
      { id: "ok", result: { kind: "text", text: "Still working" } },
    ]);
    const brokenObserver = observeModelRuntime(working, () => { throw new Error(secret); });
    expect((await brokenObserver.generate(textRequest)).ok).toBe(true);
  });

  it("counts streaming completions and early cancellation exactly once", async () => {
    const calls: ModelCallDiagnostic[] = [];
    const streaming: ModelRuntime = {
      capabilities: { structuredOutput: true, streamingText: true },
      generate: (async () => { throw new Error("unused"); }) as ModelRuntime["generate"],
      async *streamText() {
        yield { kind: "text" as const, text: secret };
        yield { kind: "complete" as const, metadata: {
          runtimeId: "stream", elapsedMs: 8,
          usage: { inputTokens: 12, outputTokens: 4 },
        } };
      },
    };
    const observed = observeModelRuntime(streaming, (call) => calls.push(call), () => "presenting");
    for await (const _event of observed.streamText!(textRequest)) { /* consume */ }
    expect(calls).toEqual([expect.objectContaining({
      status: "ok", phase: "presenting", inputTokens: 12, outputTokens: 4, elapsedProviderMs: 8,
    })]);
    const iterator = observed.streamText!(textRequest)[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.status).toBe("failed");
    expect(JSON.stringify(calls)).not.toContain(secret);
  });
});
