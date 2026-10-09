# Sign in with ChatGPT provider readiness

**Status: BLOCKED — not implemented and not enabled for release.**

This is a preflight record for a possible player-owned ChatGPT inference provider. It does not announce provider support or authorize a release. The desktop currently configures a local model before opening the game UI; no ChatGPT sign-in, account selection, credential storage, model catalog, usage controls, or Responses API adapter is implemented.

## Release gates

Both gates must be resolved before implementing or enabling this provider in a release:

1. **Open-source eligibility and distribution.** The repository is public, but public visibility is not an open-source license. As checked on 2026-10-09, no root `LICENSE` or `LICENSE.md` is present. The project owner must make a separate decision about an explicit qualifying license, distribution, and applicable Sign in with ChatGPT terms. Do not select or apply a license in this work. If the intended product is paid or remotely hosted, use OpenAI's documented interest/approval path instead of assuming the self-service open-source route applies.
2. **Live inference compatibility.** No eligible-account proof of concept has verified a text response and the engine's constrained JSON Schema → Zod path, including operation selection. Before implementation is considered ready, an opt-in manual test must verify the current supported model catalog, schema constraints, usage metadata, stream completion, latency, and error behavior against the documented public Responses API. A failure must block rollout; it must not be worked around by weakening local schema validation.

Recheck the current [SIWC open-source eligibility guidance](https://developers.openai.com/siwc/token-sharing-open-source), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), and [terms](https://openai.com/policies/sign-in-with-chatgpt-terms/) before proceeding. This record is not a legal determination.

## Required product and usage disclosures

If the gates are resolved and the provider is later implemented:

- Before separate plan-usage consent, explain that eligible game inference uses the player's shared ChatGPT Work/Codex allowance, not ordinary ChatGPT message allowance, and can reduce usage available to Codex and other participating tools. Local inference remains available.
- ChatGPT inference sends model-safe game context to OpenAI. Sign-in does not grant access to ChatGPT conversations or memory. Keep credentials in the player's local native-app boundary and never put them in saves, prompts, logs, or diagnostics.
- While active, label the provider **Using ChatGPT plan** and link to ChatGPT's stable settings entry point with directions to **Settings → Usage**. Do not imply that the player has configured a limit.
- The weekly per-app limit is a percentage of overall weekly allowance, not a separate pool or reservation. Reaching it can stop this app while overall plan usage remains. Do not guess an allowance or reset time.
- Purchased-credit sharing is a separate account preference, off by default, and requires account eligibility, available credits, the player's opt-in, and this app's weekly limit set to 100%. A 100% app limit alone does not enable credits. Automatic credit reload/purchases are another separate setting; if enabled, credit use can cause charges without another in-game confirmation at exhaustion. The game must never change these settings or describe usage as categorically free, unlimited, or incapable of consuming credits.
- Provider-reported token counts may be shown as local diagnostics only, not as account balance, remaining allowance, or price.
- For `subscription_sharing_usage_limit_exceeded` (429), pause automatic use and offer **Manage usage**, manual retry after user action, and **Switch to Local**. Do not infer which limit was reached or when it resets. Treat `subscription_sharing_usage_unavailable` (503) as temporary availability uncertainty, not quota exhaustion; treat `subscription_sharing_user_not_eligible` (403) as an eligibility issue. Do not recommend credit purchases as the default recovery.
- A failed or interrupted multi-call turn must not silently replay or duplicate a world mutation. Resuming requires an explicit valid provider/retry choice.

Use the official [ChatGPT plan usage help](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites) to recheck limits, credits, and recovery wording before release.

## Implementation readiness checklist

- [ ] Project owner has decided the qualifying license and distribution plan; applicable SIWC terms have been reviewed.
- [ ] The opt-in live proof of concept passes text and schema-constrained structured gameplay calls without weakening engine validation.
- [ ] The local model is prepared on demand so a ChatGPT-only player can start without its first-run download.
- [ ] Native browser OAuth, PKCE/OIDC validation, account/workspace separation, secure local credential storage, scope consent, rotation/revocation, and disconnect behavior are implemented and tested.
- [ ] The provider uses only the documented public Responses API with preview constraints, consumes complete streams before accepting results, and has mocked integration coverage for failures and recovery.
- [ ] Player consent, persistent usage labeling, settings link, shared-usage and credit disclosures, and actionable limit/eligibility/offline recovery are implemented.
- [ ] An opt-in manual smoke test exercises an eligible account and the normal game path; no credentials or hidden game context enter diagnostics.

Until these gates and implementation checks pass, the supported desktop inference path remains local-only. Do not present ChatGPT as an available provider in onboarding or settings.
