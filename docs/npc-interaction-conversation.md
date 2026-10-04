# NPC Interaction & Conversation

**Status:** Settled and implementation-ready by Issue #14 — NPC Interaction & Conversation  
**Scope:** Freeform player/NPC conversation, scene-local actor cognition, social uncertainty, multi-NPC reaction orchestration, communication consequences, transcript/memory policy, narration length preferences, and NPC-initiated action execution.

## Goal

Conversation should feel like tabletop roleplay rather than a dialogue tree.

The player may describe what their character says, quote exact words, mix speech with ordinary actions, or refer to their character in first or third person. NPCs respond as persistent people with their own knowledge, beliefs, goals, relationships, memories, commitments, and current circumstances.

Conversation prose is not a side door around simulation.

The core separation is:

> **Durable actor state says who this person is over time. Scene-local cognition says what is going through their head right now. Actor decision output says what they intend to say or do next. Validated operations/events say what actually happens. Prose says how the committed moment is presented.**

## Conversation Is Not a Game Mode

Do not create a separate dialogue-tree runtime.

A conversation is an interaction-local continuity among actors who are currently engaged with one another. The player may freely mix:

- speech;
- movement;
- observation;
- physical interaction;
- item use;
- purchases/transfers;
- social pressure;
- investigation;
- combat/risky actions;
- powers;
- leaving the interaction.

Examples of valid declarations:

- `I ask about the missing chicken.`
- `Liam asks about the missing chicken.`
- `I ask, "Have you heard anything about the missing chicken?"`
- `I pick up the feather and ask, "Is this from your coop?"`
- `I back toward the door and tell Gary I think something is outside.`

Conversation orchestration coordinates these declarations with the same action-pressure, operation, resolution, time, persistence, and context systems used elsewhere.

## Player Speech Forms

Support three semantic input forms.

### Described speech

The player specifies what they communicate without fixing exact wording.

Examples:

- `I ask about the missing chicken.`
- `Liam tells her what happened at the barn.`
- `I apologize and ask whether we can start over.`

The model may render natural wording for presentation, but it may not materially strengthen, weaken, or change what the player authorized.

A described question may not become:

- an accusation;
- a threat;
- a promise;
- a confession;
- a lie;
- a romantic advance;
- an agreement;
- a disclosure the player did not authorize.

### Quoted speech

The player fixes literal wording.

Example:

- `I ask, "Have you heard anything about the missing chicken?"`

The exact player-authored quoted text must be preserved as the character's wording if that speech occurs. Presentation may add surrounding description but may not rewrite the quote.

### Mixed speech

The declaration contains both described intent and literal quoted portions.

Example:

- `I try to sound casual and say, "So... you seen the chicken?"`

Quoted portions remain literal. Described framing constrains tone/intent but cannot authorize materially different speech.

### First person vs third person

`I ask...` and `Liam asks...` are equivalent when Liam is the active player character.

Pronoun/person choice is presentation style, not a separate mechanic.

## Communication Act Contract

Normalize relevant speech into structured **communication acts** rather than treating prose as authority.

Exact schema names may vary, but a communication act must preserve enough information to distinguish:

- speaker;
- intended recipient(s);
- input mode: described / quoted / mixed;
- exact player-authored quote fragments when present;
- concise authorized semantic content;
- request/question/assertion/disclosure/promise/threat/offer/agreement or other relevant semantic acts;
- intended social effect, if any;
- whether the declaration also contains non-speech action;
- information the player explicitly intends to reveal;
- material commitments the player explicitly intends to make.

The structured interpretation may clarify ambiguity, but it may not add consequential content the player did not supply.

## Scene-Local Actor Cognition

Persistent NPC state from #13 answers who the NPC is across time.

Conversation additionally needs a private, non-authoritative **scene-local actor state** for materially involved NPCs.

This state represents the NPC's current working interpretation of the immediate interaction, such as:

- what they currently think is happening;
- what has their attention;
- immediate priorities;
- immediate emotional/social stance;
- what they want from this interaction;
- what they are reluctant to reveal;
- what they are considering doing next;
- salient expectations about other participants;
- unresolved questions they are actively thinking about.

Do not impose a universal emotion/personality taxonomy. The representation should be structured enough to validate identity/provenance but flexible enough for game packages and model reasoning.

### Authority

Scene-local actor state:

- is not canonical World State;
- is not objective truth;
- is not a durable NPC memory;
- may not introduce facts outside the actor's authorized perspective;
- may be revised as the scene changes;
- expires when the interaction no longer needs it.

If scene-local cognition produces something that should persist, it must cross into existing authoritative systems:

- belief;
- goal;
- relationship;
- episodic memory;
- commitment;
- event;
- ordinary world state.

### Perspective

Every NPC reasoning call is assembled with that NPC's actor perspective.

The call may receive:

- relevant durable goals;
- outgoing relationships;
- beliefs;
- memories;
- commitments;
- current world circumstances the NPC can perceive/know;
- recent authorized interaction history;
- that NPC's own prior scene-local state.

It may not receive another actor's hidden beliefs/goals/memories merely because they are in the same scene.

## Who Gets Individual Cognition

Do not run one model agent for every entity in a location.

Individual scene cognition is created/updated only for actors who are materially relevant, such as:

- active conversation participants;
- people directly addressed;
- people actively observing and plausibly reacting;
- actors whose current goals/circumstances give them a material reason to respond;
- newly promoted scene people after the player makes them relevant.

Ambient/background people remain compact scene context until individual identity matters.

Promotion/densification must follow existing #17/#13 no-retcon rules.

## NPC Decision Contract

NPC intention selection and final dialogue prose are separate model responsibilities.

An actor-reasoning step returns a structured decision that can express, as applicable:

- actor ID;
- interpretation of the latest beat;
- intended response kind: speak / act / both / no-material-response;
- intended semantic speech content;
- intended disclosure/withholding/deception;
- intended social effect;
- proposed non-speech action;
- immediate scene-state update;
- whether an authoritative check/operation appears necessary;
- reason for stopping/deferring.

The decision is not itself an authoritative action.

Any consequential action/check must execute through existing validated engine/rules boundaries before narration.

The final dialogue/presentation call receives the validated decision plus committed consequences and produces prose. Prose may not add new decisions, facts, promises, transfers, or actions.

## Social Checks

Speech itself does not require a check merely because words were spoken.

Use the same uncertainty philosophy as every other action:

- **automatic** when the intended social effect follows without meaningful uncertainty;
- **impossible** when the intended effect is not plausibly achievable under the present circumstances;
- **uncertain** when the outcome is materially contested or genuinely uncertain.

Social checks should therefore be common whenever human uncertainty actually matters, but there is no rule that "dialogue requires a roll."

Examples likely to require resolution when contested:

- persuasion;
- deception;
- intimidation;
- negotiation;
- extracting reluctant disclosure;
- concealing a motive under scrutiny;
- socially reading a guarded reaction;
- influencing a material decision.

Examples that normally do not require a check by themselves:

- saying hello;
- asking a neutral question;
- stating a fact;
- making a request to someone already willing to comply;
- ordinary small talk;
- providing information the recipient is willing to hear.

### Social effects are bounded

A successful social check is not mind control.

The attempted effect must be represented at a scope the fiction/rules can plausibly produce.

For example:

- "get Gary to admit what he saw" may be automatic/uncertain/impossible depending on state;
- "make Gary abandon his family and become my servant" may simply be impossible.

### Active ruleset owns mechanics

The generic conversation layer does not define Persuasion, Deception, Intimidation, or universal social stats.

The active ruleset's ordinary resolution operations own uncertain social mechanics.

The reference ruleset may use the same Performance/Resistance machinery as other actions, with orchestration proposing relevant attributes, skills, circumstances, Effect, and Resistance.

### Checks against the player character

NPC social actions may create rule-supported external consequences such as Stress, observable deception cues, commitments, or other effects.

They may not force the human player to choose a belief, agreement, relationship, or course of action unless an explicit rules mechanic legitimately constrains character agency.

An NPC persuasion success does not cause the game to write the PC's next decision.

## Knowledge, Claims, Lies, and Testimony

Communication does not automatically turn a proposition into world truth.

If Liam says:

> "The chicken is behind the shed."

the authoritative consequences may include:

- Liam communicated that claim;
- Gary heard it;
- Gary may form/update a belief based on that testimony;
- the interaction may affect trust or another relationship dimension.

The proposition "the chicken is behind the shed" becomes canonical world truth only through the existing world-fact authority system.

### Deception

An NPC may lie only from an actor decision grounded in what the NPC actually knows/believes/intends.

A lie may create testimony and influence a recipient's belief if validated resolution supports that outcome.

Private truth status does not leak into actor-facing context.

For player-facing deception by an NPC, resolution may determine what cues/evidence are available to the PC, but the system should not forcibly author the player's subjective belief.

## Consequential Communication

Ordinary chatter does not require durable state.

Consequential communication must be translated into structured authoritative proposals when relevant.

Examples include:

- disclosure of material information;
- promises;
- agreements;
- offers accepted/rejected;
- future meetings;
- threats with durable significance;
- purchases/trades/transfers;
- relationship-changing statements/actions;
- testimony that changes beliefs;
- commitments/obligations;
- materially significant requests.

Use existing canonical systems whenever possible:

- beliefs and belief provenance;
- actor goals;
- relationships;
- memories;
- commitments;
- inventory/resource mutations;
- meaningful events;
- setting/rules operations.

Do not create a second "conversation consequences" truth store.

## Canonical Communication Record

When later causality needs proof that a communication occurred, persist a structured communication event or equivalent canonical record.

It should capture semantic facts such as:

- speaker;
- recipients;
- fictional time;
- semantic act(s);
- source/provenance;
- related entities/events;
- exact player-authored quote when literal wording is itself materially relevant.

Generated NPC prose and generated wording for described player speech are presentation, not canonical truth.

For described speech, persist the authorized semantic content rather than pretending model-generated wording was literally spoken.

## Immediate Knowledge vs Durable Memory

Recent conversation belongs primarily in working interaction context.

An NPC does not need a durable episodic memory record for every sentence they heard thirty seconds ago.

### Immediate belief changes

When testimony/observation immediately changes an actor's usable knowledge, create/update the appropriate belief through normal validated authority boundaries before later decisions rely on it.

### Durable memory extraction

At meaningful scene beats, interaction compaction, or scene end, run a structured extraction pass that may propose durable:

- episodic memories;
- belief updates;
- relationship changes;
- goals;
- commitments.

Only salient material should persist.

The extraction pass proposes. Validation/commit decides.

Do not preserve every conversational sentence as a durable memory.

## Transcript Policy

Conversation transcripts are useful but non-authoritative.

Maintain recent turns verbatim enough to preserve:

- exact player quotes;
- final NPC wording;
- local referents;
- immediate conversational continuity.

As context grows, older turns may be compacted into a non-authoritative interaction summary plus the durable canonical consequences that actually matter.

Future simulation must not re-read prose transcripts and infer new truth that was never committed.

Transcript/scene-state storage may be interaction/session data rather than World State and does not create world revisions.

## Multi-NPC Scenes

A scene may contain multiple independently reasoned NPCs.

After a player beat:

1. a scene-level orchestration step identifies actors with a material reason to react;
2. each selected NPC reasons from that actor's own perspective and scene-local state;
3. consequential actions/checks execute through authoritative boundaries;
4. state/context is rebuilt after commits;
5. additional immediate NPC reactions may occur if the changed scene gives another actor a material reason to react;
6. control returns to the player at the first appropriate stop boundary.

Do not use one omniscient prose call to invent every NPC's private thoughts and decisions.

### Reaction-chain stop boundaries

Return control to the player when any of these occurs:

- a meaningful player choice is available;
- an NPC directly expects/requests an answer from the PC;
- circumstances materially change;
- continuing would require deciding the PC's behavior;
- Action Pressure/horizon no longer authorizes further immediate development;
- there is no additional material NPC reaction.

A high implementation-only safety ceiling may stop runaway model loops, but it is not a fictional turn rule and should not normally determine pacing.

## NPC-Initiated Actions

An NPC decision does not mutate reality.

If an NPC intends to:

- attack;
- flee;
- move;
- use an item;
- lock a door;
- call emergency services;
- purchase/transfer something;
- use a power;
- physically intervene;
- perform another consequential act,

that intention must enter the same operation/resolution/time/persistence machinery used for player actions.

Implementation may extract/reuse generic actor-execution internals from #11 rather than duplicating mechanics.

NPC actions must not gain a privileged direct-mutation path.

## Action Pressure and Conversation

Action Pressure applies to speech because speech consumes fictional time.

At low pressure, broad declarations such as:

> "I explain everything that happened this morning and ask what she thinks."

may validly cover minutes.

At high pressure, only the amount of speech/action that can plausibly occur inside the authorized horizon may resolve before interruption/control returns.

Conversation does not create rounds or a "one sentence per turn" rule.

Quoted player speech must never be silently rewritten to fit pressure.

If a material interruption prevents a broad communication from completing, the game records only what actually occurred before the interruption and returns control appropriately.

## Player Control

The game may never continue the PC's side of the conversation beyond the player's authorization.

It may not invent that the player character:

- answers an unanswered question;
- accepts/refuses an offer;
- makes a promise;
- confesses;
- threatens;
- lies;
- flirts;
- forgives;
- agrees to a plan;
- changes their mind;
- takes another consequential action.

Presentation may describe observable delivery/body language consistent with the player's authorized declaration, but may not make new PC decisions.

## Narration Length Preference

Response length is a **non-authoritative player presentation preference**, separate from Action Pressure and separate from how much fiction is allowed to happen.

Expose three preference profiles:

- **Concise**
- **Standard** (default)
- **Expansive**

For each response, the orchestration/presentation layer chooses one of three target bands based on how much information must be communicated:

- **small**
- **medium**
- **large**

Initial tuning targets are character counts, not hard truncation limits:

| Preference | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| Concise | 80–300 | 300–700 | 700–1,200 |
| Standard | 120–450 | 450–1,000 | 1,000–1,800 |
| Expansive | 180–600 | 600–1,400 | 1,400–2,600 |

The model/presentation planner chooses the band based on the committed beat.

Examples:

- even under Expansive, a terse reaction may correctly use the small band;
- even under Concise, a complicated multi-NPC consequence may require the large band.

These are target ranges. Do not truncate mid-thought merely to hit a character ceiling. Essential clarity, committed consequences, and required player-facing information take precedence.

### Configuration boundary

The selected preference is a user/session presentation setting, not World State:

- changing it does not advance time;
- changing it does not create a world revision/event;
- changing it does not change NPC intent, checks, facts, or consequences.

#14 should expose the headless preference contract and use it in conversation narration. Final settings UI/persistence belongs to the playable application work (#19) unless a minimal existing application-setting seam is convenient to add without coupling it to World State.

Presentation/game packages may supply defaults/tone guidance, but the player's selected preference controls the active target profile.

## Turn Lifecycle

A conversation-capable player beat should follow this conceptual lifecycle:

1. accept the player's freeform declaration;
2. interpret communication form/authorized semantic content without adding player decisions;
3. assess Action Pressure/horizon using existing rules;
4. execute any player non-speech/consequential social action through ordinary action machinery;
5. commit any actual structured communication/testimony consequences required before NPCs rely on them;
6. rebuild current scene/context after every commit;
7. select materially relevant NPC responders;
8. for each responder, assemble actor-perspective context plus that actor's scene-local state;
9. request a structured NPC decision;
10. execute any consequential NPC action/check through ordinary operation/resolution boundaries;
11. commit durable belief/social/world consequences that are justified;
12. continue immediate reaction chain only while stop conditions allow;
13. perform memory/compaction extraction when warranted;
14. choose response-length band from the player's preference;
15. generate final player-facing narration/dialogue only from authorized player speech, NPC decisions, and committed results;
16. retain recent non-authoritative transcript/scene continuity for the next beat.

A model failure in final prose must not roll back already committed state.

## Framework Boundary

### Generic conversation orchestration

May own:

- communication-act schemas;
- conversation/interaction IDs;
- scene-local actor state contracts;
- NPC decision contracts;
- transcript/working-context orchestration;
- response-length preference/band contracts;
- stop conditions;
- coordination with model runtime/context/action execution.

### Active ruleset

Owns:

- social uncertainty mechanics;
- Performance/Resistance or equivalent;
- stress/status/effect consequences;
- mechanical action feasibility.

### Setting/campaign

Owns:

- actual people;
- relationships/cultures/institutions;
- what facts actors know;
- scene circumstances;
- setting-specific social norms/consequences.

### Presentation config

Owns:

- voice/tone/terminology;
- default narration guidance.

It does not own NPC knowledge or social mechanics.

### LLM

May:

- interpret speech form/semantics;
- maintain scene-local cognition proposals;
- propose NPC decisions;
- propose social-check inputs;
- propose durable memory/belief/social consequences;
- generate final prose.

It may not:

- read unauthorized perspective data;
- invent PC decisions;
- mutate canonical state directly;
- make generated prose authoritative;
- bypass rules resolution.

## Implementation Contract

Add the smallest reusable generic conversation seam consistent with existing engine modules.

Exact module names may vary, but implementation must provide validated contracts for at least:

- player communication interpretation;
- communication acts;
- conversation/interaction working state;
- scene-local NPC state;
- structured NPC decisions;
- conversation stop reasons;
- narration length preference/profile/band;
- structured communication record/event payload where causally needed;
- structured durable-consequence proposals/extraction.

Provide a headless conversation orchestrator that accepts:

- current `GameSession`/runtime dependencies;
- model runtime;
- player actor;
- location/working context;
- freeform declaration;
- current narration preference.

The orchestrator must reuse:

- #10 perspective context;
- #11 execution/transaction boundaries;
- #13 actor social/belief state;
- #15 structured/text model runtime;
- #26 commitment/grounding rules where provisional content enters conversation.

If NPC actor execution requires factoring a reusable actor-execution seam out of the player pipeline, do so without weakening #11's player-specific authorization or replay protections.

## Verification Scenarios

### Missing chicken: described vs quoted speech

Using the same player/NPC state, run:

- `I ask about the missing chicken.`
- `Liam asks about the missing chicken.`
- `I ask, "Have you heard anything about the missing chicken?"`

Verify:

- all three authorize equivalent question semantics;
- first/third person do not change game meaning;
- exact quote is preserved;
- described forms do not acquire an accusation/threat/promise;
- NPC decision is grounded in the same actor perspective.

### Knowledge boundary

1. NPC A does not know a hidden event.
2. Player asks about it.
3. NPC A cannot reveal it.
4. Player truthfully communicates the event through an engine-recorded interaction.
5. validated testimony/belief update commits.
6. a later NPC A decision can use the newly learned belief.
7. NPC B, who did not hear/learn it, still cannot use that information.

### Social uncertainty

Exercise all three paths:

- willing NPC + ordinary request -> automatic/no check;
- impossible request under current goals/circumstances -> impossible;
- reluctant but persuadable NPC -> uncertain social resolution using active ruleset mechanics.

Verify success changes only the bounded intended effect and never grants mind control.

### Scene cognition

1. Two NPCs are present with different beliefs/goals/relationships.
2. One player statement materially affects both.
3. each actor receives separate perspective-safe reasoning context;
4. their scene-local interpretations/intentions diverge;
5. one speaks while the other chooses a non-speech action;
6. only durable consequences cross into World State;
7. ending the scene discards purely local cognition without losing committed beliefs/memories/relationships.

### NPC action

NPC decides to leave and call emergency services.

Verify:

- structured actor decision is separate from prose;
- movement/call consequences use existing execution/persistence machinery;
- no direct model mutation occurs;
- later context sees the committed result.

### Response length

For one terse committed beat and one complicated multi-NPC beat, run Concise, Standard, and Expansive preferences.

Verify:

- the selected small/medium/large band may differ by beat;
- Expansive may still choose small;
- Concise may still choose large;
- target ranges influence generation without truncating required information;
- changing preference changes no canonical state/revision.

## Acceptance Criteria

- [ ] described, quoted, and mixed player speech are supported
- [ ] first-person and player-character-name third-person declarations are semantically equivalent
- [ ] quoted player text is preserved exactly when spoken
- [ ] described speech cannot silently add consequential player intent
- [ ] conversation is interaction continuity, not a separate dialogue-tree mode
- [ ] conversation may coexist with ordinary physical/risky actions
- [ ] materially involved NPCs receive private scene-local cognition grounded only in their perspectives
- [ ] ambient NPCs do not each require continuous model reasoning
- [ ] NPC structured decision output is separate from final dialogue prose
- [ ] ordinary speech requires no check unless a material effect is uncertain
- [ ] automatic/impossible/uncertain social paths reuse the active ruleset's resolution philosophy
- [ ] successful social resolution is bounded and does not create mind control
- [ ] NPC social checks do not author PC choices/beliefs without an explicit rules effect
- [ ] claims/testimony do not automatically become world truth
- [ ] deception preserves perspective/truth boundaries
- [ ] consequential speech can commit beliefs, goals, relationships, memories, commitments, events, transfers, or other existing structured consequences
- [ ] no parallel conversation-truth store is created
- [ ] recent transcript/scene state remains non-authoritative working context
- [ ] older transcript may compact without losing committed consequences
- [ ] selective durable memory extraction avoids one-memory-per-line behavior
- [ ] multi-NPC reactions use separate actor-perspective reasoning
- [ ] reaction chains stop at meaningful player choice/answer/material-change/pressure boundaries
- [ ] NPC-initiated consequential actions use ordinary operation/resolution/persistence machinery
- [ ] Action Pressure bounds conversation without introducing rounds
- [ ] the game never invents the PC's next conversational decision
- [ ] Concise/Standard/Expansive response preferences exist with small/medium/large target bands
- [ ] response-length preference is non-authoritative and separate from Action Pressure
- [ ] response targets are guidance rather than hard mid-thought truncation
- [ ] perspective verification proves an NPC cannot reveal unknown information and can use it only after validated learning
- [ ] persisted consequences survive ending/restarting conversation context
- [ ] architecture boundaries remain intact
- [ ] `npm run check` passes

## Non-Goals

- voice/audio
- romance-system breadth
- scripted dialogue trees
- cinematic dialogue UI
- continuous autonomous LLM agents for every NPC
- universal personality/emotion taxonomy
- universal social-skill taxonomy in the engine
- final application settings UI/persistence (#19)
- campaign planning/replanning (#28)
