import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OllamaModelRuntime } from "../apps/desktop/src/model/ollama-model-runtime.js";

const manual = process.env.OLLAMA_SMOKE === "1" ? describe : describe.skip;

manual("manual Ollama smoke", () => {
  it("validates a structured intent-style result through the provider-neutral boundary", async () => {
    const model = process.env.OLLAMA_MODEL;
    if (!model) throw new Error("OLLAMA_MODEL must name an installed model");
    const runtime = new OllamaModelRuntime({
      baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      model,
    });
    const schema = z
      .object({
        actor: z.string().min(1),
        goal: z.string().min(1),
      })
      .strict();
    const result = await runtime.generate({
      prompt: {
        instructions: [
          "Extract the explicitly named actor and their stated goal. Do not add facts.",
        ],
        input: "Amelia wants to inspect the locked door.",
      },
      output: { kind: "structured", schemaId: "smoke-intent", schema },
      trace: { operation: "manual-smoke" },
    }, { timeoutMs: 120_000, generation: { temperature: 0 } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
    expect(result.output.value).toEqual({
      actor: "Amelia",
      goal: "inspect the locked door",
    });

    let authoritativeOperationCalls = 0;
    const intentionallyRejectingSchema = schema.refine(
      () => false,
      "Manual smoke intentionally rejects the provider result",
    );
    const rejected = await runtime.generate({
      prompt: {
        instructions: ["Extract the named actor and goal as JSON."],
        input: "Amelia wants to inspect the locked door.",
      },
      output: {
        kind: "structured",
        schemaId: "smoke-rejected-intent",
        schema: intentionallyRejectingSchema,
      },
    }, { timeoutMs: 120_000, generation: { temperature: 0 } });
    if (rejected.ok) authoritativeOperationCalls += 1;
    expect(rejected).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ kind: "invalid-output" }),
    }));
    expect(authoritativeOperationCalls).toBe(0);
  }, 260_000);
});
