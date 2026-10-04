import { jsonValueSchema, type JsonValue } from "@llm-ttrpg/engine";
import type {
  HarnessSnapshot,
  HarnessSnapshotCategory,
  SemanticChange,
  SemanticDiff,
} from "./contracts.js";

function json(value: unknown): JsonValue {
  return jsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function keyedChanges(
  category: HarnessSnapshotCategory,
  before: readonly { readonly id?: string; readonly actorId?: string; readonly entityId?: string; readonly scopeId?: string }[],
  after: readonly { readonly id?: string; readonly actorId?: string; readonly entityId?: string; readonly scopeId?: string }[],
  keyOf: (value: typeof before[number]) => string,
): SemanticChange[] {
  const left = new Map(before.map((value) => [keyOf(value), value]));
  const right = new Map(after.map((value) => [keyOf(value), value]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  const changes: SemanticChange[] = [];
  for (const key of keys) {
    const oldValue = left.get(key);
    const newValue = right.get(key);
    if (oldValue === undefined) {
      changes.push({ category, path: key, kind: "added", after: json(newValue) });
      continue;
    }
    if (newValue === undefined) {
      changes.push({ category, path: key, kind: "removed", before: json(oldValue) });
      continue;
    }
    if (!same(oldValue, newValue)) {
      changes.push({
        category,
        path: key,
        kind: "changed",
        before: json(oldValue),
        after: json(newValue),
      });
    }
  }
  return changes;
}

export function diffSnapshots(
  before: HarnessSnapshot,
  after: HarnessSnapshot,
): SemanticDiff {
  const changes: SemanticChange[] = [];
  if (before.state.fictionalTime !== after.state.fictionalTime) {
    changes.push({
      category: "time",
      path: "fictionalTime",
      kind: "changed",
      before: before.state.fictionalTime,
      after: after.state.fictionalTime,
    });
  }
  if (before.revision !== after.revision) {
    changes.push({
      category: "revision",
      path: "revision",
      kind: "changed",
      before: before.revision,
      after: after.revision,
    });
  }
  changes.push(
    ...keyedChanges("entities", before.state.entities, after.state.entities, (v) => v.id!),
    ...keyedChanges("facts", before.state.facts, after.state.facts, (v) => v.id!),
    ...keyedChanges("beliefs", before.state.beliefs, after.state.beliefs, (v) => v.id!),
    ...keyedChanges("documents", before.state.documents, after.state.documents, (v) => v.id!),
    ...keyedChanges(
      "actor-social-state",
      before.state.actorSocialStates,
      after.state.actorSocialStates,
      (v) => v.actorId!,
    ),
    ...keyedChanges(
      "mechanical-realizations",
      before.state.mechanicalRealizations,
      after.state.mechanicalRealizations,
      (v) => v.entityId!,
    ),
    ...keyedChanges(
      "scheduled-triggers",
      before.state.scheduledTriggers,
      after.state.scheduledTriggers,
      (v) => v.id!,
    ),
    ...keyedChanges(
      "simulation-cursors",
      before.state.simulationCursors,
      after.state.simulationCursors,
      (v) => v.scopeId!,
    ),
    ...keyedChanges("events", before.history, after.history, (v) => v.id!),
  );
  if (!same(before.state.randomness, after.state.randomness)) {
    changes.push({
      category: "rng",
      path: "randomness",
      kind: "changed",
      before: json(before.state.randomness),
      after: json(after.state.randomness),
    });
  }
  if (!same(before.diagnostics, after.diagnostics)) {
    changes.push({
      category: "diagnostics",
      path: "diagnostics",
      kind: before.diagnostics === undefined
        ? "added"
        : after.diagnostics === undefined
          ? "removed"
          : "changed",
      ...(before.diagnostics === undefined ? {} : { before: before.diagnostics }),
      ...(after.diagnostics === undefined ? {} : { after: after.diagnostics }),
    });
  }
  const ordered = changes.sort((left, right) =>
    left.category.localeCompare(right.category) || left.path.localeCompare(right.path)
  );
  return {
    fromRevision: before.revision,
    toRevision: after.revision,
    changes: ordered,
    changedCategories: [...new Set(ordered.map((change) => change.category))].sort(),
  };
}
