import { describe, expect, it } from "vitest";
// `?raw` rather than `node:fs`: this project's frontend tsconfig declares `types:
// ["vite/client"]` and no node types, and pulling those in here would widen the global
// environment for every frontend test to get at one file read.
import viteConfigSource from "../../vite.config.ts?raw";
import httpRunClientSource from "../../src/data/HttpRunClient.ts?raw";
import avatarApiSource from "../../src/data/avatarApi.ts?raw";

/**
 * Every backend path prefix the app calls has to be listed in the dev server's proxy table.
 *
 * A prefix that is missing does not fail loudly. Vite falls through to the SPA and serves
 * `index.html` for the request, the client tries to parse HTML as JSON, and the UI reports a
 * bare 404 against a route that exists and is running. `/avatar` shipped exactly that way:
 * the routes were registered, the server was up, the key was present, and the browser saw
 * "request to /avatar/sheet failed with status 404".
 *
 * Reading the files as TEXT rather than importing them for real is deliberate.
 * `vite.config.ts` pulls in the React plugin, and the client modules reference `fetch` and
 * `EventSource`; this check should not stand or fall on either being loadable in a test
 * environment.
 */

/** The leading path segment of every root-relative URL literal in a client module. */
function calledPrefixes(source: string): Set<string> {
  const out = new Set<string>();
  // Matches "/runs", `${this.baseUrl}/runs/...` and any other literal starting at a slash.
  for (const [, prefix] of source.matchAll(/["'`](?:\$\{[^}]*\})?\/([a-z][a-z0-9-]*)/gi)) {
    if (prefix) out.add(`/${prefix.toLowerCase()}`);
  }
  return out;
}

function proxiedPrefixes(config: string): Set<string> {
  const table = config.slice(config.indexOf("proxy:"));
  return new Set([...table.matchAll(/["'](\/[a-z0-9-]+)["']\s*:/gi)].map((m) => m[1]!.toLowerCase()));
}

describe("the dev server proxy table", () => {
  const proxied = proxiedPrefixes(viteConfigSource);

  it("covers every prefix HttpRunClient calls", () => {
    for (const prefix of calledPrefixes(httpRunClientSource)) {
      expect(proxied.has(prefix), `${prefix} is not proxied in vite.config.ts`).toBe(true);
    }
  });

  it("covers every prefix the avatar pipeline calls", () => {
    for (const prefix of calledPrefixes(avatarApiSource)) {
      expect(proxied.has(prefix), `${prefix} is not proxied in vite.config.ts`).toBe(true);
    }
  });

  it("proxies the three prefixes the backend actually registers", () => {
    // Named explicitly as well as derived, so deleting a call site does not quietly shrink
    // what this test checks.
    expect([...proxied].sort()).toEqual(["/avatar", "/runs", "/versions"]);
  });
});
