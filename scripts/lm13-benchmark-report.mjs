#!/usr/bin/env node
/**
 * LM-13 privacy-safe report from an existing scripts/live-replay-session.ts trace.
 * Raw prompts, responses, declarations, transcript and canonical world data
 * MUST NOT be exported into a benchmark report.
 */
import { readFile, writeFile } from "node:fs/promises";
import { cpus, freemem, totalmem, platform, arch, release } from "node:os";

function usage() {
  console.error("Usage: node scripts/lm13-benchmark-report.mjs <trace.json> <report.json> [baseline-report.json]");
  process.exitCode = 2;
}
const [input, output, baselinePath] = process.argv.slice(2);
if (!input || !output) {
  usage();
} else {
  const trace = JSON.parse(await readFile(input, "utf8"));
  if (!Array.isArray(trace.modelInvocations)) {
    throw new Error("Trace must contain modelInvocations array from live-replay-session");
  }
  const calls = trace.modelInvocations.map((call) => ({
    // Deliberately allowlist metrics; no raw messages or model results.
    kind: call.outputKind === "structured" ? "structured" : "text",
    phase: typeof call.operation === "string" ? call.operation.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 64) : "unavailable",
    durationMs: Number.isFinite(call.elapsedMs) && call.elapsedMs >= 0 ? call.elapsedMs : null,
    success: call.result?.ok === true ? true : call.result?.ok === false ? false : null,
    // Runtime trace currently does not guarantee normalized token counts.
    inputTokens: null,
    outputTokens: null,
  }));
  const durations = calls.map(c => c.durationMs).filter(n => n !== null);
  const elapsedMs = durations.length === calls.length
    ? durations.reduce((a, b) => a + b, 0) : null;
  const errors = calls.filter(c => c.success === false).length;
  const summarize = r => ({
    invocations: r.invocations,
    providerDurationMs: r.providerDurationMs,
    failedInvocations: r.failedInvocations,
  });
  const report = {
    schemaVersion: "lm13-benchmark-v1",
    sourceType: "live-replay-trace",
    collectedAt: new Date().toISOString(),
    environment: {
      platform: platform(),
      architecture: arch(),
      osRelease: release(),
      cpuModel: cpus()[0]?.model ?? "unavailable",
      cpuThreads: cpus().length,
      totalMemoryBytes: totalmem(),
      availableMemoryBytesAtReportGeneration: freemem(),
      modelId: "unavailable",
      modelHash: "unavailable",
      quantization: "unavailable",
      runtimeRevision: "unavailable",
      contextTokens: "unavailable",
      warmed: "unavailable",
    },
    // This is a sum of measured provider calls, NOT end-to-end wall time.
    metrics: {
      invocations: calls.length,
      providerDurationMs: elapsedMs,
      failedInvocations: errors,
      endToEndDurationMs: null,
      inputTokens: null,
      outputTokens: null,
      // Not inferable safely from the older raw trace contract:
      canonicalChanges: null,
      gameplayQuality: null,
    },
    calls,
    limitations: [
      "Provider duration is summed per call, not full turn latency.",
      "Token counts, model identity, output quality and state correctness require independent evidence.",
      "Report-generation host may differ from the host that produced the trace.",
      "A single run cannot establish p90/p95 latency or gameplay quality.",
    ],
  };
  if (baselinePath) {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    if (baseline.schemaVersion !== report.schemaVersion) {
      throw new Error("Baseline schema version differs");
    }
    report.comparison = {
      baseline: summarize(baseline.metrics),
      candidate: summarize(report.metrics),
      // Differences are descriptive; not a performance improvement claim.
      invocationDelta: report.metrics.invocations - baseline.metrics.invocations,
      providerDurationDeltaMs: baseline.metrics.providerDurationMs === null
        || report.metrics.providerDurationMs === null ? null
        : report.metrics.providerDurationMs - baseline.metrics.providerDurationMs,
    };
  }
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log("Wrote sanitized LM-13 report:", output);
}
