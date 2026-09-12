import type { DiffLine } from "../domain/textDiff.js";

export type PromptDiffProps = {
  lines: DiffLine[];
  title: string;
  /**
   * True when the two compared versions are, in fact, the same version — the caller (`VersionCompare`)
   * is the one that knows this, since it holds both `VersionRow`s. Distinguishes an empty `lines`
   * array's two different honest readings: "there is nothing before this one to diff against" vs.
   * "two distinct versions were compared and their content matched". Collapsing those would be the
   * same mistake `DeltaBadge` avoids by keeping "not comparable" separate from a plain dash.
   */
  sameVersion?: boolean;
};

/**
 * Unified diff between two rubric or prompt files (design doc §5 "Versions screen"). `−`/`+` are
 * literal characters, same colour pair as `FragmentDiffRow`'s `<del>`/`<ins>`, so the two diff
 * views on this product read as one system. Never animated — motion spec §11.2: "a block of text,
 * and animating it would be the whole-text rewrite the Run screen forbids, re-imported onto
 * another screen."
 *
 * An empty diff renders explicit text, never a bare `<pre>` — the same rule this screen already
 * applies to an unmeasured kappa ("not measured"), an unmeasured delta ("not comparable"), and a
 * null check profile ("not scored yet"): absence says why, rather than rendering as nothing or as
 * a blank container.
 */
export function PromptDiff({ lines, title, sameVersion = false }: PromptDiffProps): React.JSX.Element {
  return (
    <div className="prompt-diff">
      <p className="prompt-diff__title">{title}</p>
      {lines.length === 0 ? (
        <p className="prompt-diff__empty">
          {sameVersion
            ? "No prior version to compare against — this is the only version in its line."
            : "No differences between these versions."}
        </p>
      ) : (
        <pre className="prompt-diff__body">
          <code>
            {lines.map((line, i) => (
              <div key={i} className="prompt-diff__line" data-kind={line.kind}>
                <span className="prompt-diff__marker" aria-hidden="true">
                  {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
                </span>
                <span className="prompt-diff__text">{line.text}</span>
              </div>
            ))}
          </code>
        </pre>
      )}
    </div>
  );
}
