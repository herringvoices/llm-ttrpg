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
      /\b(?:dice|difficulty class|attack roll|saving throw|opposed check|success boolean|degree of success|critical hit)\b/i;
    const violations = engineFiles.filter((path) =>
      forbiddenMechanics.test(readFileSync(path, "utf8")),
    );

    expect(violations).toEqual([]);
  });
});
