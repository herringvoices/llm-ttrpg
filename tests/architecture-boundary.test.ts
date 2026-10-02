import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

function findTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return findTypeScriptFiles(path);
    }
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

describe("engine package boundary", () => {
  it("does not import reference-game, desktop, React, Tauri, or SQLite", () => {
    const engineFiles = findTypeScriptFiles("packages/engine/src");
    const violations = engineFiles.filter((path) => {
      const source = readFileSync(path, "utf8");
      return /(?:from|import\s*\()["'][^"']*(?:reference-game|apps\/desktop|react|@tauri-apps|sqlite)/i.test(source);
    });

    expect(violations).toEqual([]);
  });

  it("keeps SQL out of React components", () => {
    const componentFiles = findTypeScriptFiles("apps/desktop/src").filter(
      (path) => path.endsWith(".tsx"),
    );
    const violations = componentFiles.filter((path) =>
      /(?:SELECT|INSERT|UPDATE|DELETE)\s/i.test(readFileSync(path, "utf8")),
    );
    expect(violations).toEqual([]);
  });

  it("keeps game-specific check mechanics out of engine contracts", () => {
    const engineFiles = findTypeScriptFiles("packages/engine/src");
    const forbiddenMechanics =
      /\b(?:dice|difficulty class|attack roll|saving throw|opposed check|success boolean|degree of success|critical hit|attribute|skill specificity|potential effect|realized effect|stress track|taken out|initiative|combat round)\b/i;
    const violations = engineFiles.filter((path) =>
      forbiddenMechanics.test(readFileSync(path, "utf8")),
    );

    expect(violations).toEqual([]);
  });

  it("keeps tool catalog namespaces composed rather than hardcoded", () => {
    const source = readFileSync("packages/engine/src/tool-catalog.ts", "utf8");
    expect(source).not.toMatch(/domainId:\s*["']/);
    expect(source).not.toMatch(/(?:reference-game|awakening-earth)/i);
  });

  it("keeps disposable engine-contract fixtures out of the active ruleset", () => {
    const source = readFileSync(
      "packages/reference-game/src/ruleset/index.ts",
      "utf8",
    );
    expect(source).not.toMatch(/resolve-effort|resolve-contract-fixture|fixture/i);
  });

  it("keeps provider types out of engine and model-runtime callers", () => {
    const engineSource = findTypeScriptFiles("packages/engine/src")
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const applicationSource = readFileSync(
      "apps/desktop/src/application.ts",
      "utf8",
    );
    expect(engineSource).not.toMatch(/\bollama\b|llama\.cpp/i);
    expect(applicationSource).not.toMatch(/\bollama\b|OllamaChat/i);
  });

  it("keeps gameplay and context authorization semantics out of the Ollama adapter", () => {
    const source = readFileSync(
      "apps/desktop/src/model/ollama-model-runtime.ts",
      "utf8",
    );
    expect(source).not.toMatch(
      /WorldState|ActionPressure|KnowledgePerspective|SceneManifest|CampaignPlan|Awakening Earth|reference-game/i,
    );
    const contextSource = readFileSync(
      "packages/engine/src/context-contracts.ts",
      "utf8",
    );
    expect(contextSource).not.toMatch(/inputTokens|outputTokens|contextWindowTokens/);
  });
});
