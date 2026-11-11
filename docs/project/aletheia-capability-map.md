# Aletheia capability map

This page lists what the Aletheia engine (the licensed sidecar at `http://aletheia:8000`, internal codename `cortex0`) can do over HTTP, where Meridian uses each capability, and what we propose for the ones it does not use. It was written on 11 November 2026 from the engine's request handler (`cortex0/server.py`, read only) and Meridian's client (`api/services/aletheia_engine.py`).

Two rules bound every use. Only run-level aggregates (scores and counts keyed by metric name) go to the engine; no extracted SAP record, field value, personal data or free text does. Deterministic checks stay primary: every engine result sits beside a deterministic result that answers when the engine is off, unreachable or unlicensed.

## HTTP capabilities

| Capability | Engine route | Used by Meridian (where) | Proposed use |
|---|---|---|---|
| Health and version | `GET /health` | Used: engine status, Administration, Aletheia engine (`/api/v1/aletheia/engine`, `design/v2/admin/engine.tsx`) | Keep |
| Licence verdict, expiry, usage | `GET /api/{tenant}/license` | Used: the same status call; every engine call is gated on it (`_gate`) | Keep |
| Tenant registry | `GET` and `POST /api/tenants` | Used: Meridian registers its own engine tenant once (`_ensure_tenant`) | Keep |
| Self-learning: normal ranges and lead and lag links | `POST /api/{tenant}/learn` | Used: Insights, "What moves the score" (`/api/v1/insights/engine-drivers`); new on this branch, the composite's learned normal range on Foresight | Keep |
| World-model surprise (spiking encoder plus JEPA latent dynamics) | `POST /api/{tenant}/model-insights` | Used from this branch: Foresight, "What the engine did not expect" (`/api/v1/aletheia/foresight`, `design/v2/screens/AletheiaForesight.tsx`). Unused before | Done. Next: raise a monitor alert when the latest run is a surprise |
| Dynamic reasoning: KPI anomalies and causal risks over one snapshot | `POST /api/{tenant}/reason` | Unused | Second surface: send the latest run's aggregates and the learned links, show the measures the engine flags as at risk beside the deterministic movers on Insights |
| Business findings costed in money | `POST /api/{tenant}/insights` | Unused | Not proposed. Its money figure is costed for business KPIs (cost of capital), not data quality; Meridian's money figure stays the tenant-set config impact model. The model-insights client already drops it |
| Grounded question answering and conversation | `POST /api/{tenant}/ask`, `/converse`, `GET .../search`, `.../node` | Unused | Not proposed. They answer over a text corpus held by the engine; feeding it would send record text, which the aggregates-only rule forbids |
| Voice | `/api/voice/speak`, `/api/{tenant}/voice/...` | Unused | Not proposed: no buyer need in a data-quality product |
| OpenAI-compatible model surface | `GET /v1/models`, chat completions | Unused | Not proposed: Meridian's language model tiers are set in `llm/provider.py`; routing them to the engine would mix the two products' boundaries |
| Metrics, status, updates, terms, admin billing and downloads | `/metrics`, `/status`, `/updates`, `/terms`, `/api/admin/...`, `/api/download/...` | Unused | Not proposed: operator and licensor functions, not product features |

## Library capabilities with no HTTP route

The engine repository also holds forecasting, causal discovery, golden records, a rules store, reconciliation, comparison, temporal analysis and active inference as Python modules. None is reachable over HTTP, and Meridian contains none of the engine's code, so Meridian cannot use them without a new engine release. Meridian already has deterministic equivalents for most of them: the predictive score forecast, the fix simulator, readiness, learned rules and rule promotion, survivorship, learned monitors, anomaly rules and cause clusters. If the licensor exposes forecasting over HTTP, the natural use is a second, engine-learned band beside Foresight's deterministic band.

## Before and after this branch

| | Before | After |
|---|---|---|
| Engine routes called | 4 (`/health`, `/license`, `/api/tenants`, `/learn`) | 5 (adds `/model-insights`) |
| Product-relevant engine capabilities used | 1 of 3 (learn; reason and model-insights unused) | 2 of 3 (reason left, proposed above) |
| Meridian screens backed by the engine | 2 (Administration, Aletheia engine; Insights, What moves the score) | 3 (adds Foresight at `/aletheia/foresight`) |

## Foresight, the surface added here

- Route: `GET /api/v1/aletheia/foresight`, permission `view` (`api/routes/aletheia_engine.py`).
- Deterministic layer (`api/services/aletheia_foresight.py`): a least-squares line through the composite score of each run against calendar days, with a 95% prediction interval; the go-live date is the first day the line reaches the tenant's target, and the earliest and latest dates are the first days the band edges reach it. It answers with the engine off.
- Engine layer: the composite's learned normal range (`/learn`) and the runs the world model did not expect (`/model-insights`), each with the measure that diverged, what the model expected and what was observed. Sent: the run-trend series only. Cached ten minutes; 30-second timeout.
- Screen: evidence panel (inputs, method, confidence) under each result, the Aletheia mark on the engine section, and an empty state naming the reason when the engine cannot be used (too few runs, not configured, unreachable, no token, licence invalid, engine error).
- Tests: `tests/test_aletheia_foresight.py` (5) and `frontend/design/v2/__tests__/AletheiaForesight.test.tsx` (3).
