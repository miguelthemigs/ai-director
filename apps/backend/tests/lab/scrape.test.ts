import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SCRAPE_TEXT_CAP, extractPage, scrapeUrl } from "../../src/lab/scrape.js";

const FIXTURE = readFileSync(path.join(import.meta.dirname, "fixtures", "product-page.html"), "utf8");

function fakeFetch(body: string, init: { status?: number; url?: string } = {}): typeof fetch {
  return vi.fn(async () => {
    const response = new Response(body, { status: init.status ?? 200 });
    Object.defineProperty(response, "url", { value: init.url ?? "https://example.com/aurora" });
    return response;
  }) as unknown as typeof fetch;
}

describe("extractPage", () => {
  const page = extractPage(FIXTURE);

  it("reads the title, the description and the Open Graph fields", () => {
    expect(page.title).toBe("Aurora Headphones & Case | Northwind Audio");
    expect(page.description).toBe("Wireless over-ear headphones with a soft-touch matte finish.");
    expect(page.ogTitle).toBe("Aurora Headphones");
    expect(page.ogDescription).toBe("Quiet, light, and built for long days.");
  });

  it("lists h1-h3 in document order", () => {
    expect(page.headings).toEqual(["Aurora Headphones", "Built for long days", "In the box"]);
  });

  it("keeps the visible text and drops scripts, styles, navigation, footer and svg", () => {
    expect(page.text).toContain("sand-coloured fabric with brushed aluminium arms");
    expect(page.text).toContain('Memory-foam cushions & a padded headband');
    expect(page.text).toContain('a short "quick start" card');
    for (const gone of ["SECRET_TRACKING_CODE", "font-family", "Shop all products", "footer text", "icon text", "enable JavaScript"]) {
      expect(page.text).not.toContain(gone);
    }
  });

  it("caps the text", () => {
    const big = extractPage(FIXTURE.replace("<main>", `<main>${"<p>Long paragraph about the product. </p>".repeat(500)}`));
    expect(big.text.length).toBeLessThanOrEqual(SCRAPE_TEXT_CAP);
  });

  it("returns empty text for a page that builds itself in the browser", () => {
    const empty = extractPage('<html><body><div id="root"></div><script>render()</script></body></html>');
    expect(empty.text).toBe("");
    expect(empty.headings).toEqual([]);
  });
});

describe("scrapeUrl", () => {
  it("fetches one page and keeps where it ended up", async () => {
    const result = await scrapeUrl("https://example.com/a", fakeFetch(FIXTURE, { url: "https://example.com/aurora" }));
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.url).toBe("https://example.com/a");
    expect(result.finalUrl).toBe("https://example.com/aurora");
    expect(result.title).toBe("Aurora Headphones & Case | Northwind Audio");
  });

  it("records an HTTP error and goes on", async () => {
    const result = await scrapeUrl("https://example.com/a", fakeFetch("denied", { status: 403 }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("HTTP 403");
    expect(result.text).toBe("");
  });

  it("records a fetch that throws", async () => {
    const failing = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND example.invalid");
    }) as unknown as typeof fetch;
    const result = await scrapeUrl("https://example.invalid", failing);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ENOTFOUND");
  });

  it("never fetches something that is not an http(s) url", async () => {
    const fetchImpl = fakeFetch(FIXTURE);
    const result = await scrapeUrl("not a url", fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not a url");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a page with nothing in it as fetched, with no text", async () => {
    const result = await scrapeUrl(
      "https://example.com/app",
      fakeFetch('<html><body><div id="root"></div><script>render()</script></body></html>'),
    );
    expect(result.ok).toBe(true);
    expect(result.text).toBe("");
  });
});
