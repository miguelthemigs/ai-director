import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { FixtureRunClient } from "./data/FixtureRunClient.js";
import "./styles/tokens.css";
import "./styles/base.css";

// The only file in the app that constructs a RunClient. Swapping FixtureRunClient for the real
// HttpRunClient in Phase C is a one-line change here — every screen and every test only ever sees
// the RunClient interface (src/data/RunClient.ts).
const client = new FixtureRunClient();

const container = document.getElementById("root");
if (!container) throw new Error("#root element missing from index.html");

createRoot(container).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
);
