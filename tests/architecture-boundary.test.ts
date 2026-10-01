import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

function findTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return findTypeScriptFiles(path);
    }
    return extname(entry.name) === ".ts" ? [path] : [];
  });
}

describe("engine package boundary", () => {
  it("does not import the reference game", () => {
    const engineFiles = findTypeScriptFiles("packages/engine/src");
    const violations = engineFiles.filter((path) => {
      const source = readFileSync(path, "utf8");
      return /(?:from|import\s*\()["'][^"']*reference-game/.test(source);
    });

    expect(violations).toEqual([]);
  });
});
