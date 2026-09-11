import { useState } from "react";

export type PayloadViewerProps = {
  value: unknown;
  maxHeight?: number;
  onCopy?: () => void;
};

/** Matches a JSON string's own tokens well enough to colour them without a parser: a quoted key
 *  or string (a trailing `:` after the closing quote marks it a key), `true`/`false`/`null`, or a
 *  number. Nothing else about the JSON's structure is touched — punctuation and whitespace pass
 *  through untouched, so this can never corrupt the text it renders. */
const TOKEN_RE = /("(?:\\u[0-9a-fA-F]{4}|\\.|[^"\\])*"\s*:?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g;

function classify(token: string): "key" | "string" | "number" | "keyword" {
  if (token.startsWith('"')) return /:\s*$/.test(token) ? "key" : "string";
  if (token === "true" || token === "false" || token === "null") return "keyword";
  return "number";
}

function renderTokens(json: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of json.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(json.slice(lastIndex, index));
    const token = match[0];
    nodes.push(
      <span key={key++} className={`payload__${classify(token)}`}>
        {token}
      </span>,
    );
    lastIndex = index + token.length;
  }
  if (lastIndex < json.length) nodes.push(json.slice(lastIndex));
  return nodes;
}

/**
 * The real payload a step produced, as Courier Prime JSON (design doc §5: "No syntax-highlighting
 * library" — the colouring above is a plain regex over the already-correct `JSON.stringify`
 * output, never a re-parse that could disagree with it).
 *
 * `null`/`undefined` is not "no data to show" rendered as an empty pane — it says plainly that
 * this step has not produced anything yet, which is the same honesty rule that keeps cost fields
 * from rendering a fabricated `$0.00` (task 15 brief).
 */
export function PayloadViewer({ value, maxHeight = 320, onCopy }: PayloadViewerProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  if (value === null || value === undefined) {
    return <p className="payload payload--empty">No payload — this step has not produced one yet.</p>;
  }

  const json = JSON.stringify(value, null, 2);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied or simply absent (tests, some browsers/contexts); the JSON
      // is still selectable text in the pane either way, so this is not worth surfacing as a fault.
    }
    onCopy?.();
  }

  return (
    <div className="payload">
      <div className="payload__toolbar">
        <span className="payload__toolbar-label">Payload</span>
        <button type="button" className="payload__copy" onClick={handleCopy}>
          {copied ? "copied" : "⧉ copy"}
        </button>
      </div>
      <pre className="payload__body tnum" style={{ maxHeight }}>
        <code>{renderTokens(json)}</code>
      </pre>
    </div>
  );
}
