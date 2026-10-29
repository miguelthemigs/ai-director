/**
 * The lab's scraper: one GET, one page, text only. No browser, no crawling, no JavaScript,
 * so a page that builds itself in the browser yields little text; that is recorded, not
 * worked around. It never throws: a failed fetch comes back `ok: false` with the reason,
 * and the run goes on (the Interrogator then asks about the product).
 */
export type ScrapeResult = {
  url: string;
  finalUrl: string | null;
  ok: boolean;
  error: string | null;
  title: string | null;
  description: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  headings: string[];
  text: string;
  fetchedAt: string;
};
export type PageText = Pick<ScrapeResult, "title" | "description" | "ogTitle" | "ogDescription" | "headings" | "text">;

export const SCRAPE_TEXT_CAP = 6000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITIES[name] ?? "");
}

const clean = (text: string): string => decode(text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function metaContent(html: string, attr: "name" | "property", key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const named = new RegExp(`\\b${attr}\\s*=\\s*["']${key}["']`, "i").test(tag);
    if (!named) continue;
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i);
    if (content) return clean(content[1] ?? content[2] ?? "") || null;
  }
  return null;
}

const DROPPED = ["script", "style", "noscript", "nav", "footer", "svg", "head"];

export function extractPage(html: string): PageText {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const headings = [...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => clean(match[1] ?? ""))
    .filter((heading) => heading !== "");

  let body = html;
  for (const tag of DROPPED) body = body.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), " ");

  return {
    title: title ? clean(title[1] ?? "") || null : null,
    description: metaContent(html, "name", "description"),
    ogTitle: metaContent(html, "property", "og:title"),
    ogDescription: metaContent(html, "property", "og:description"),
    headings,
    text: clean(body).slice(0, SCRAPE_TEXT_CAP),
  };
}

const EMPTY: PageText = { title: null, description: null, ogTitle: null, ogDescription: null, headings: [], text: "" };

export async function scrapeUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<ScrapeResult> {
  const fetchedAt = new Date().toISOString();
  const failed = (error: string, finalUrl: string | null = null): ScrapeResult => ({
    url,
    finalUrl,
    ok: false,
    error,
    ...EMPTY,
    fetchedAt,
  });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return failed(`not a url: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return failed(`not a url: ${url}`);

  try {
    const response = await fetchImpl(parsed, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const finalUrl = response.url || null;
    if (!response.ok) return failed(`HTTP ${response.status}`, finalUrl);
    return { url, finalUrl, ok: true, error: null, ...extractPage(await response.text()), fetchedAt };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}
