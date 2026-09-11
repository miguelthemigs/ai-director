import type { DiffLine } from "../domain/textDiff.js";

export type PromptDiffProps = {
  lines: DiffLine[];
  title: string;
};

/**
 * Unified diff between two rubric or prompt files (design doc §5 "Versions screen"). `−`/`+` are
 * literal characters, same colour pair as `FragmentDiffRow`'s `<del>`/`<ins>`, so the two diff
 * views on this product read as one system. Never animated — motion spec §11.2: "a block of text,
 * and animating it would be the whole-text rewrite the Run screen forbids, re-imported onto
 * another screen."
 */
export function PromptDiff({ lines, title }: PromptDiffProps): React.JSX.Element {
  return (
    <div className="prompt-diff">
      <p className="prompt-diff__title">{title}</p>
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
    </div>
  );
}
