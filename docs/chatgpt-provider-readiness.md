# Sign in with ChatGPT provider readiness

**Status: NEEDS DESIGN — isolated development proof of concept added; live-account results pending.**

This is a preflight record for a possible player-owned ChatGPT inference provider. It does not announce provider support or authorize a release. The desktop still configures a local model before opening the game UI. The proof of concept is a separate command-line test and is not connected to game startup, saves, or gameplay.

## Release gates

Resolve these gates before implementing or enabling the full provider in a release:

1. **Open-source eligibility and distribution.** The project owner approved adding the root [MIT license](../LICENSE); existing third-party notices and licenses are unchanged. Public visibility and an MIT file do not alone confirm SIWC eligibility or acceptance of the distribution/terms. Verify the current self-service eligibility and terms before treating this gate as cleared. If the intended product is paid or remotely hosted, use OpenAI's documented interest/approval path.
2. **Live inference compatibility.** Automated tests cover local protocol helpers only. An eligible-account live run has not yet verified authorization, the account model catalog, text generation, or the constrained JSON Schema → Zod round trip. The owner should run the manual procedure below and record the observed model(s), schema support, usage metadata, completion, latency, and errors. A failure blocks rollout; do not weaken local schema validation to make it pass.

Recheck the current [SIWC open-source eligibility guidance](https://developers.openai.com/siwc/token-sharing-open-source), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), and [terms](https://openai.com/policies/sign-in-with-chatgpt-terms/) before proceeding. This record is not a legal determination.

## Development-only proof of concept

Run from the repository root with Node.js 20 or newer:

```sh
npm ci
npm run siwc:poc
```

The script opens the system browser, listens only on `127.0.0.1` on an ephemeral port, and uses a one-time state, OIDC nonce, and PKCE S256 verifier. It requests `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` and explicitly stops if the token response does not grant both inference scopes. It then verifies the ID token signature and issuer, audience, nonce, expiry, and subject; lists models returned by the signed-in account; and asks you to choose one.

The test makes exactly two streamed requests to the public `/v1/responses` endpoint with `store: false`: one short text request, then a strict JSON Schema operation-selection example based on [the existing runtime test](../tests/model-runtime.test.ts). It accepts the structured result only after a completed response stream and local Zod validation. Reported token counts are diagnostics, not an account balance or price.

The script uses the `dynamic_agent_client` bootstrap registration, `llm-ttrpg` agent name hint, and a stable per-installation host ID. That host ID is stored under the user's configuration directory; access/refresh tokens and authorization codes are held only in process memory and are not persisted or printed. The returned issued client ID is reported but not saved. The proof of concept does not implement account/workspace switching, refresh, revocation, persistence of registrations, in-game provider selection, provider fallback, or any billing setting. The issued client ID and token-handling behavior must be resolved before full integration.

**Before running:** use only your own eligible account; the two requests can consume the same shared ChatGPT Work/Codex allowance described below. Purchased-credit use depends on your independent ChatGPT settings, and the script cannot display or change app limits, credit sharing, or automatic reload. Do not paste credentials, access/refresh tokens, authorization codes, or cookies into an issue, terminal transcript, or report. To stop before completing authorization, interrupt the command.

When reporting results, include the selected model ID, whether each response completed, whether Zod validation passed, any provider error code/status, and approximate elapsed time. Do not include identity claims, prompts, response bodies, or credentials. If system-browser launch or access to OpenAI fails, record that as an environment/authorization blocker; do not substitute a private endpoint or API key.

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

- [x] Project owner approved the root MIT license; third-party licensing notices remain unchanged.
- [ ] Current SIWC self-service eligibility, distribution requirements, and applicable terms have been rechecked and confirmed.
- [ ] The opt-in live proof of concept passes text and schema-constrained structured calls; supported models, limitations, usage, completion, and errors are recorded.
- [ ] The local model is prepared on demand so a ChatGPT-only player can start without its first-run download.
- [ ] Native browser OAuth, PKCE/OIDC validation, account/workspace separation, secure local credential storage, scope consent, rotation/revocation, and disconnect behavior are implemented and tested.
- [ ] The provider uses only the documented public Responses API with preview constraints, consumes complete streams before accepting results, and has mocked integration coverage for failures and recovery.
- [ ] Player consent, persistent usage labeling, settings link, shared-usage and credit disclosures, and actionable limit/eligibility/offline recovery are implemented.
- [ ] An opt-in manual smoke test exercises an eligible account and the normal game path; no credentials or hidden game context enter diagnostics.

Keep issue #77 in **Needs Design** until the manual proof-of-concept results and eligibility review are recorded. Until the full implementation checks pass, the supported desktop inference path remains local-only. Do not present ChatGPT as an available provider in onboarding or settings.
