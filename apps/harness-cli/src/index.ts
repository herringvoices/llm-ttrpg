import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import type { ModelRuntime } from "@llm-ttrpg/engine";
import {
  createHarness,
  fantasyHarnessScenario,
  reproductionBundleSchema,
  type HarnessSession,
  type HarnessSnapshot,
  type TraceLevel,
} from "@llm-ttrpg/harness";

async function configuredRealModel(): Promise<ModelRuntime | undefined> {
  const modulePath = process.env.HARNESS_MODEL_MODULE;
  if (!modulePath) return undefined;
  const loaded = await import(pathToFileURL(resolve(modulePath)).href) as {
    modelRuntime?: ModelRuntime;
    default?: ModelRuntime;
  };
  const runtime = loaded.modelRuntime ?? loaded.default;
  if (!runtime?.generate) {
    throw new Error(
      "HARNESS_MODEL_MODULE must default-export a ModelRuntime or export modelRuntime",
    );
  }
  return runtime;
}

const realModelRuntime = await configuredRealModel();
const harness = createHarness({
  scenarios: [fantasyHarnessScenario],
  ...(realModelRuntime ? { realModelRuntime } : {}),
});
let active: HarnessSession | undefined;
let root: HarnessSession | undefined;
const snapshots = new Map<string, HarnessSnapshot>();
let jsonOutput = process.argv.includes("--json");

function print(value: unknown): void {
  if (jsonOutput || typeof value !== "string") {
    output.write(`${JSON.stringify(value, null, jsonOutput ? 0 : 2)}\n`);
  } else {
    output.write(`${value}\n`);
  }
}

function requireSession(): HarnessSession {
  if (!active) throw new Error("No scenario loaded. Use: load <scenario-id>");
  return active;
}

function splitCommand(line: string): string[] {
  const values: string[] = [];
  line.replace(/"([^"]*)"|'([^']*)'|(\S+)/g, (_match, double, single, bare) => {
    values.push(double ?? single ?? bare);
    return "";
  });
  return values;
}

function parseJson(text: string | undefined): unknown {
  if (!text) throw new Error("This command requires a JSON argument");
  return JSON.parse(text);
}

async function command(line: string): Promise<boolean> {
  const [name, ...args] = splitCommand(line.trim());
  if (!name) return true;
  switch (name) {
    case "help":
      print([
        "scenarios | load <id> | reset | status | game | state | history",
        "rng | simulation | time <ms> | catchup <scope> [max-work]",
        "event <json> | mutations <json-array> | schedule <json> | operation <id> <json>",
        "query <tool-id> <authorization-json> <input-json>",
        "action <actor-id> <declaration> | context <json> | tools",
        "snapshot <name> | diff <name> | fork <name> | forks",
        "use-fork <name> | use-root | discard-fork <name>",
        "trace [summary|decision|full] | trace-level <level>",
        "export <path> | replay <path> | json on|off | exit",
      ]);
      return true;
    case "scenarios":
      print(harness.listScenarios());
      return true;
    case "load":
      root = await harness.loadScenario(args[0] ?? "");
      active = root;
      snapshots.clear();
      print({ loaded: root.scenarioId, worldId: root.worldId });
      return true;
    case "reset":
      await requireSession().reset();
      print({ reset: requireSession().scenarioId });
      return true;
    case "status": {
      const session = requireSession();
      const persisted = await session.inspectPersistedWorld();
      print({
        scenarioId: session.scenarioId,
        worldId: session.worldId,
        revision: persisted.revision,
        fictionalTime: persisted.state.fictionalTime,
        traceLevel: session.selectedTraceLevel(),
        realModelConfigured: Boolean(realModelRuntime),
      });
      return true;
    }
    case "game":
      print(requireSession().game().composition);
      return true;
    case "state":
      print(requireSession().world());
      return true;
    case "history":
      print(await requireSession().eventHistory());
      return true;
    case "rng":
      print(requireSession().rngInspection());
      return true;
    case "simulation":
      print(requireSession().simulationInspection());
      return true;
    case "time":
      await requireSession().advanceTime(Number(args[0]));
      print(requireSession().world().fictionalTime);
      return true;
    case "catchup":
      print(await requireSession().catchUp({
        scopeId: args[0] ?? "",
        ...(args[1] ? { maxWorkUnits: Number(args[1]) } : {}),
      }));
      return true;
    case "event":
      print(await requireSession().injectEvent(parseJson(args[0]) as never));
      return true;
    case "mutations":
      await requireSession().injectMutations(parseJson(args[0]) as never[]);
      print("Validated mutations committed.");
      return true;
    case "operation":
      print(await requireSession().executeOperation(args[0] ?? "", parseJson(args[1])));
      return true;
    case "schedule":
      print(await requireSession().scheduleTrigger(parseJson(args[0]) as never));
      return true;
    case "query":
      print(await requireSession().inspectQuery(
        args[0] ?? "",
        parseJson(args[2]),
        parseJson(args[1]) as never,
      ));
      return true;
    case "action":
      print(await requireSession().executeAction({
        actionId: `harness-action-${Date.now()}`,
        actorId: args[0] ?? "",
        declaration: args[1] ?? "",
        budget: { maxUnits: 50_000 },
      }));
      return true;
    case "context":
      print(requireSession().inspectContext(parseJson(args[0]) as never));
      return true;
    case "tools":
      print(requireSession().inspectTools());
      return true;
    case "snapshot": {
      const key = args[0] ?? "latest";
      snapshots.set(key, await requireSession().snapshot());
      print({ snapshot: key });
      return true;
    }
    case "diff": {
      const before = snapshots.get(args[0] ?? "");
      if (!before) throw new Error(`Snapshot not found: ${args[0]}`);
      print(requireSession().diff(before, await requireSession().snapshot()));
      return true;
    }
    case "fork": {
      const session = requireSession();
      const fork = await session.fork(args[0] ?? "");
      active = fork;
      print({ fork: args[0], worldId: fork.worldId });
      return true;
    }
    case "forks":
      print((root ?? requireSession()).listForks());
      return true;
    case "use-fork":
      active = (root ?? requireSession()).getFork(args[0] ?? "");
      print({ activeFork: args[0] });
      return true;
    case "use-root":
      active = root ?? requireSession();
      print({ active: "root" });
      return true;
    case "discard-fork":
      print({ discarded: (root ?? requireSession()).discardFork(args[0] ?? "") });
      return true;
    case "trace":
      print(requireSession().trace(args[0] as TraceLevel | undefined));
      return true;
    case "trace-level":
      requireSession().setTraceLevel(args[0] as TraceLevel);
      print({ traceLevel: requireSession().selectedTraceLevel() });
      return true;
    case "export": {
      const bundle = await requireSession().exportReproduction();
      await writeFile(args[0] ?? "harness-reproduction.json", JSON.stringify(bundle, null, 2));
      print({ exported: args[0] ?? "harness-reproduction.json" });
      return true;
    }
    case "replay": {
      const bundle = reproductionBundleSchema.parse(JSON.parse(
        await readFile(args[0] ?? "", "utf8"),
      ));
      if (!root || root.scenarioId !== bundle.scenarioId) {
        root = await harness.loadScenario(bundle.scenarioId);
      }
      active = root;
      print(await root.replayReproduction(bundle));
      return true;
    }
    case "json":
      jsonOutput = args[0] === "on";
      print({ json: jsonOutput });
      return true;
    case "exit":
    case "quit":
      return false;
    default:
      throw new Error(`Unknown command: ${name}. Use 'help'.`);
  }
}

async function main(): Promise<void> {
  const nonInteractive = process.argv.slice(2).filter((arg) => arg !== "--json");
  if (nonInteractive.length > 0) {
    await command(nonInteractive.join(" "));
    return;
  }
  print("LLM TTRPG developer harness. Type 'help'.");
  const repl = createInterface({ input, output });
  try {
    while (await command(await repl.question("> "))) {
      // Persistent session intentionally remains loaded between commands.
    }
  } finally {
    repl.close();
  }
}

main().catch((error: unknown) => {
  output.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
