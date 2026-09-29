# Project Board Workflow

GitHub Project: https://github.com/users/herringvoices/projects/10/

## Status columns

### Project Reference

Permanent reference items that capture decisions the rest of the project must respect.

### Icebox

Good ideas that are intentionally outside the current design/implementation focus.

### Needs Design

Important capabilities whose contracts or behavior are still unresolved.

### Ready for Codex

The design questions are resolved enough to hand the entire issue to Codex as a coherent implementation slice.

A card should not move here until its outcome, boundaries, acceptance criteria, and verification scenario are clear.

### In Progress

Currently being implemented.

### Verify / Playtest

Implementation exists, but we still need to prove the behavior works in practice.

### Done

The capability satisfies its acceptance criteria.

## Labels

Use labels for subsystems rather than board columns:

- Core Engine
- Time & World Simulation
- Actions & Rules
- Context & Tools
- NPCs & Social
- LLM Runtime
- Persistence
- World / Content
- Player UX
- Dev Tools / Testing
- Later / Graphics
- Blocked

A capability may have multiple subsystem labels.

## Capability issue structure

Each major work item should contain:

### Outcome

What capability exists when this issue is complete?

### Why

Why does the engine need it?

### Current Decisions

What has already been settled and should not be reopened accidentally?

### Open Design Questions

What decisions still prevent implementation?

### Acceptance Criteria

What observable behavior proves the slice works?

### Non-Goals

What tempting adjacent work is deliberately excluded?

### Dependencies

What other capability slices does this depend on?

### Verification Scenario

A small concrete scenario that demonstrates the capability.

### Implementation Notes

Schemas, interfaces, algorithms, or likely modules once they are known.

## Sizing rule

Issues should be sized for an AI coding agent capable of substantial repository-wide work, not for a human sprint board.

Avoid splitting a coherent capability into mechanical subtasks unless doing so establishes a genuinely useful architectural boundary.
