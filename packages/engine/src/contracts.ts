import type { ContentBundle, JsonValue } from "./content.js";
import type { ComponentIdentity, ComponentReference } from "./identity.js";
import type {
  OperationRegistry,
  RegisteredRulesOperation,
} from "./operations.js";

export interface Ruleset {
  readonly identity: ComponentIdentity;
  readonly description: string;
  readonly operations: readonly RegisteredRulesOperation[];
}

export interface Setting {
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

export interface SettingAdapter {
  readonly identity: ComponentIdentity;
  readonly description: string;
  readonly ruleset: ComponentReference;
  readonly setting: ComponentReference;
  readonly mappings: readonly SettingRuleMapping[];
}

export interface Campaign {
  readonly identity: ComponentIdentity;
  readonly description: string;
  readonly setting: ComponentReference;
  readonly startTime: string;
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
