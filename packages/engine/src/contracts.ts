import type { ContentBundle, JsonValue } from "./content.js";
import type { ComponentIdentity, ComponentReference } from "./identity.js";
import type {
  OperationRegistry,
  RegisteredRulesOperation,
} from "./operations.js";
import type {
  EventTypeRegistry,
  RegisteredEventType,
} from "./events.js";
import type { FictionalInstant } from "./time.js";

export interface EventTypeProvider {
  readonly eventTypes: readonly RegisteredEventType[];
}

export interface Ruleset extends EventTypeProvider {
  readonly identity: ComponentIdentity;
  readonly description: string;
  readonly operations: readonly RegisteredRulesOperation[];
}

export interface Setting extends EventTypeProvider {
  readonly identity: ComponentIdentity;
  readonly description: string;
  readonly content: ContentBundle;
}

export interface SettingRuleMapping {
  readonly id: string;
  readonly description: string;
  readonly settingConceptId: string;
  readonly operationId: string;
  readonly mapInput: (source: JsonValue) => unknown;
}

export interface SettingAdapter extends EventTypeProvider {
  readonly identity: ComponentIdentity;
  readonly description: string;
  readonly ruleset: ComponentReference;
  readonly setting: ComponentReference;
  readonly mappings: readonly SettingRuleMapping[];
}

export interface Campaign extends EventTypeProvider {
  readonly identity: ComponentIdentity;
  readonly description: string;
  readonly setting: ComponentReference;
  readonly startTime: FictionalInstant;
  readonly content: ContentBundle;
}

export interface PresentationConfig {
  readonly identity: ComponentIdentity;
  readonly description: string;
  readonly narrationStyle: string;
  readonly terminology: Readonly<Record<string, string>>;
  readonly revealMechanics: "minimal" | "summary" | "detailed";
}

export interface GameDefinition {
  readonly ruleset: Ruleset;
  readonly setting: Setting;
  readonly adapter: SettingAdapter;
  readonly campaign: Campaign;
  readonly presentation: PresentationConfig;
}

export interface GameComposition {
  readonly ruleset: ComponentReference;
  readonly setting: ComponentReference;
  readonly adapter: ComponentReference;
  readonly campaign: ComponentReference;
  readonly presentation: ComponentReference;
}

export interface LoadedGameDefinition extends GameDefinition {
  readonly operationRegistry: OperationRegistry;
  readonly eventTypeRegistry: EventTypeRegistry;
  readonly composition: GameComposition;
}

export function compositionFromGame(
  game: GameDefinition,
): GameComposition {
  return {
    ruleset: { ...game.ruleset.identity },
    setting: { ...game.setting.identity },
    adapter: { ...game.adapter.identity },
    campaign: { ...game.campaign.identity },
    presentation: { ...game.presentation.identity },
  };
}
