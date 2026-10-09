# LM-11: Scene pressure and deterministic action completion

## Core invariants

Action Pressure still has **nine exact maximum resolution windows**: 8 hours, 2 hours, 30 minutes, 10 minutes, 2 minutes, 1 minute, 30 seconds, 10 seconds, 5 seconds. `maximumResolutionHorizon`, `boundInterpretedIntent`, receipt immutability, randomness and save schemas are unchanged.

Pressure is not a combat/noncombat switch. The distinction is **how broadly a player's action can be resolved before the fiction requires another decision**.

### Pressure basis and sources

`scenePressureSources(world, actorId, locationId)` reads only pressure-related, authoritative scene facts (`scene.action-pressure`, `environment.action-pressure`, `actor.action-pressure`) for that actor/current location, plus relevant scheduled triggers. It derives a small scene fingerprint independent of unrelated world revisions, ordinary dialogue and wall-clock ticks. Authoritative urgent clocks and hazards take precedence over any proposed semantic pressure estimate.

`chooseScenePressure` reuses an existing assessed level when sources have not meaningfully changed. A scene transition with no continuing pressure evidence or an ended explicit threat allows the rules-engine conservative fallback (level 3), and old saves with just `{ status: "assessed", level }` keep their assessed value in the absence of a real source change. First unassessed scenes can accept one bounded semantic estimate. A known due or overdue trigger blocks further time-consuming work until the scheduled world process is handled. The basis is intentionally a derived in-session index; no stored player/NPC/private-fact migration is required.

`GameSession.ensureScenePressure` is callable by NPC interaction/scene routing. It does not commit when the level is already correct. The desktop calculates first-action pressure without a redundant pressure-only world revision; the initial assessment and action-run creation share one authoritative commit. Normal new actions also keep their already assessed pressure, regardless of any lower model-proposed level.

### Requested vs authorized vs committed duration

`declaredDurationMs` recognizes explicitly stated durations and broad morning/day expressions, preserving the player's intended scope in `ActionRun.interpretedIntent`. `boundInterpretedIntent` constrains it by scene level; known scheduled deadlines and an enclosing ordered turn's remaining window may constrain it further. `ActionRun.executableIntent.wasNarrowed` remains true when authorization is tighter. Only operation receipts count as fictional elapsed time.

The desktop shares one elapsed-time budget across ordered LM-03 action/communication segments, so a second segment never receives an unrelated full pressure window. A material pressure transition or an exhausted budget stops the rest of the declaration for a new player decision. Ordinary NPC speech and material replies consume the same remaining budget; an NPC reply or action estimated to overrun it is rejected **before** that NPC operation is committed.

At pressure 9, asking to spend the morning searching cannot claim hours of completed search: at most five seconds of authorized effort occur, and narration must report only committed outcomes. At low pressure the engine permits the larger window, subject to actual registered operation duration and relevant interruptions; permission to spend hours is **not** a fabricated successful result. Compound declarations still require ordered LM-03 segment identity, causality and durable receipts.

### Deterministic stop

On the registered-only production path the engine completes an action when the existing registered operation has **committed a recognized outcome** (e.g. a ruleset's explicit success/failure, a confirmed routine task or arrival), all supported semantic modes have actually been handled, and required ordered steps have receipts. A zero-time prerequisite such as LM-10 mechanics is not an action effect. A narrowed broad attempt stops at its budget boundary instead of claiming the larger goal. The engine stops, saves a stop reason, and calls narration **without a second model-only vote**. Creative/ambiguous effects with no authoritative completion evidence remain exceptional and may still require bounded semantic review; merely matching a mode is never enough to claim success.

The recorded outcomes, original requested horizon, authorized horizon, committed duration, source reason, stop source and pressure boundary diagnostics are inspectable in action traces. Narration still receives the immutable action pressure and the existing scene register, so high urgency stays urgent in prose.

### Compatibility and remaining integration

This is a foreground rules/coordination change, not a replacement for LM-03, LM-04, LM-05, LM-06 or LM-12. Existing game saves and action runs load without conversion. An external world revision remains a hard abort; the engine must not replay an already committed operation to accommodate a pressure change. Scene pressure sources are intentionally conservative; a reference-game hazard that is meaningful but not yet expressed as one of the registered pressure facts or scoped triggers must be connected by its owning rules/simulation ticket.

Automated checks exercise stable source fingerprints, first assessment/reuse, explicit duration parsing, high-pressure clipping, no extra post-commit stop vote, and existing persistence/receipt tests. **Local bundled-model wall-clock performance and longer cross-system scenarios remain LM-01/LM-13 integration measurements, not claims established by scripted tests.**
