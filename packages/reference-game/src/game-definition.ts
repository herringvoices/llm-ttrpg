import type { GameDefinition } from "@llm-ttrpg/engine";
import { awakeningEarthReferenceRulesAdapter } from "./adapter/index.js";
import { contractFixtureCampaign } from "./campaign/index.js";
import { groundedDramaticPresentation } from "./presentation/index.js";
import { referenceRuleset } from "./ruleset/index.js";
import { awakeningEarthSetting } from "./setting/index.js";

export const referenceGameDefinition: GameDefinition = {
  ruleset: referenceRuleset,
  setting: awakeningEarthSetting,
  adapter: awakeningEarthReferenceRulesAdapter,
  campaign: contractFixtureCampaign,
  presentation: groundedDramaticPresentation,
};
