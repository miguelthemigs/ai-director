import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { HttpRunClient } from "./data/HttpRunClient.js";
import "./styles/tokens.css";
import "./styles/base.css";

// The only file in the app that constructs a RunClient. Phase B built every screen against the
// FixtureRunClient (still exported and still used by the frontend test suite); this is the one
// line Phase C's swap to the real HttpRunClient turned out to be. An empty baseUrl means every
// request is relative to this page's own origin, which is what lets the dev proxy (vite.config.ts)
// and a same-origin production deploy both work unchanged.
const client = new HttpRunClient("");

const container = document.getElementById("root");
if (!container) throw new Error("#root element missing from index.html");

createRoot(container).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
);
