import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("LM-13 sanitized benchmark reports", () => {
  it("exports only allowlisted metadata, with missing values unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lm13-"));
    temporary.push(dir);
    const tracePath = join(dir, "trace.json");
    const reportPath = join(dir, "report.json");
    const sensitive = "SECRET_CANARY_DO_NOT_EXPORT";
    await writeFile(tracePath, JSON.stringify({
      worldId: sensitive,
      declaration: sensitive,
      before: { transcript: [sensitive] },
      after: { canonical: sensitive },
      modelInvocations: [
        { operation: "narration", outputKind: "text", elapsedMs: 33, prompt: sensitive,
          result: { ok: true, output: { text: sensitive } } },
        { operation: "route", outputKind: "structured", elapsedMs: 17, prompt: sensitive,
          result: { ok: false, failure: { message: sensitive } } },
      ],
    }), "utf8");
    const run = spawnSync(process.execPath, ["scripts/lm13-benchmark-report.mjs", tracePath, reportPath], {
      cwd: process.cwd(), encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    const serialized = await readFile(reportPath, "utf8");
    expect(serialized).not.toContain(sensitive);
    const report = JSON.parse(serialized);
    expect(report.schemaVersion).toBe("lm13-benchmark-v1");
    expect(report.metrics).toMatchObject({
      invocations: 2,
      providerDurationMs: 50,
      failedInvocations: 1,
      endToEndDurationMs: null,
      inputTokens: null,
    });
    expect(report.calls).toHaveLength(2);
  });

  it("rejects an incompatible baseline report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lm13-"));
    temporary.push(dir);
    const trace = join(dir, "trace.json");
    const output = join(dir, "out.json");
    const baseline = join(dir, "old.json");
    await writeFile(trace, '{"modelInvocations":[]}', "utf8");
    await writeFile(baseline, '{"schemaVersion":"other"}', "utf8");
    const run = spawnSync(process.execPath,
      ["scripts/lm13-benchmark-report.mjs", trace, output, baseline],
      { cwd: process.cwd(), encoding: "utf8" });
    expect(run.status).not.toBe(0);
  });
});
