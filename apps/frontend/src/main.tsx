import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import type { RunClient } from "./data/RunClient.js";
import { FixtureRunClient } from "./data/FixtureRunClient.js";
import { HttpRunClient } from "./data/HttpRunClient.js";
import "./styles/tokens.css";
import "./styles/base.css";

type FixtureScenario = "passed" | "improvedStillFailing" | "noImprovement" | "failed";

const FIXTURE_SCENARIOS: readonly FixtureScenario[] = ["passed", "improvedStillFailing", "noImprovement", "failed"];

function isFixtureScenario(value: string | null): value is FixtureScenario {
  return value !== null && (FIXTURE_SCENARIOS as readonly string[]).includes(value);
}

/**
 * `?fixture=<scenario>` (optionally `&fixtureSpeed=<ms>`) selects `FixtureRunClient` instead of
 * the real `HttpRunClient`, deterministically, from the URL alone. Added for the Playwright e2e
 * suite (`apps/frontend/e2e`), which needs to drive every terminal scenario without a backend —
 * this is the only line in this file that exists for that reason. Absent the parameter, behaviour
 * is unchanged from Phase C's swap: `HttpRunClient` against this page's own origin.
 */
function readFixtureClient(): RunClient | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get("fixture");
  if (!isFixtureScenario(scenario)) return null;
  const speedParam = params.get("fixtureSpeed");
  const speedMs = speedParam === null ? undefined : Number(speedParam);
  return new FixtureRunClient({ scenario, speedMs: Number.isFinite(speedMs) ? speedMs : undefined });
}

// The only file in the app that constructs a RunClient. Phase B built every screen against the
// FixtureRunClient (still exported and still used by the frontend test suite); this is the one
// line Phase C's swap to the real HttpRunClient turned out to be. An empty baseUrl means every
// request is relative to this page's own origin, which is what lets the dev proxy (vite.config.ts)
// and a same-origin production deploy both work unchanged.
const client: RunClient = readFixtureClient() ?? new HttpRunClient("");

const container = document.getElementById("root");
if (!container) throw new Error("#root element missing from index.html");

createRoot(container).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
);
