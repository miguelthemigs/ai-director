import { useRef, useState } from "react";
import {
  describeSheet,
  generateSheet,
  splitDataUrl,
  type DescribeResult,
  type SheetResult,
} from "../data/avatarApi.js";

export type SheetPipelineProps = {
  /** The guided form's assembled sentence. This is the IMAGE PROMPT, the text that
   *  generates the avatar, and it is never the text that gets graded. */
  seedDescription: string;
  /** Called with the description the DESCRIBE step produced: what a vision model wrote
   *  after looking at the generated avatar. This is the string the nine checks grade, and
   *  it is emphatically not the one that went in. */
  onDescription: (description: string) => void;
  disabled: boolean;
  /** Fixture mode has no backend. Both steps here spend real money, so there is nothing
   *  honest to fake, and the tab says so instead. */
  live: boolean;
};

type Loaded = { imageBase64: string; mediaType: string; source: "generated" | "uploaded" };

/** Roughly 6MB of image, which is under the route's own 8MB base64 cap once base64 adds
 *  its third. Checked here so an oversized file is refused before it is read and posted. */
const MAX_FILE_BYTES = 6 * 1024 * 1024;

/**
 * The Mentic pipeline, end to end, so the description can be measured where it is actually
 * written rather than where it is typed.
 *
 *   description  ->  doctrine call  ->  sheet layout  ->  Nano Banana Pro  ->  SHEET
 *   SHEET        ->  Mentic's describe prompt                              ->  DESCRIPTION
 *
 * Why both steps are separate buttons: a description can lose a check in three different
 * places. The form may never have asked for the thing, the authoring step may have dropped
 * it, or the describe step may not have been able to read it back off the rendered sheet.
 * Running the whole thing on one click and reporting a score would collapse all three into
 * one number. Stopping between them, with the sheet and both prompts on screen, is what
 * makes the loss locatable.
 *
 * Uploading is the other half of that. A sheet rendered in Mentic itself can be dropped in
 * here directly, which measures Mentic's real output rather than a re-render of it.
 */
export function SheetPipeline({
  seedDescription,
  onDescription,
  disabled,
  live,
}: SheetPipelineProps): React.JSX.Element {
  const [sheet, setSheet] = useState<SheetResult | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [described, setDescribed] = useState<DescribeResult | null>(null);
  const [busy, setBusy] = useState<null | "sheet" | "describe">(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const canGenerate = live && !disabled && busy === null && seedDescription.trim().length > 0;
  const canDescribe = live && !disabled && busy === null && loaded !== null;

  async function onGenerate(): Promise<void> {
    setBusy("sheet");
    setError(null);
    // The old sheet and its description are cleared together. Leaving a description on
    // screen beside a new sheet it was not written from is the exact kind of mismatch this
    // tool exists to catch.
    setSheet(null);
    setLoaded(null);
    setDescribed(null);
    try {
      const result = await generateSheet(seedDescription.trim());
      setSheet(result);
      setLoaded({ imageBase64: result.imageBase64, mediaType: result.mediaType, source: "generated" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function onFile(file: File): void {
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 6MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError("That file could not be read.");
    reader.onload = () => {
      const split = typeof reader.result === "string" ? splitDataUrl(reader.result) : null;
      if (!split) {
        setError("That file is not an image the vision API accepts.");
        return;
      }
      setSheet(null);
      setDescribed(null);
      setLoaded({ ...split, source: "uploaded" });
    };
    reader.readAsDataURL(file);
  }

  async function onDescribe(): Promise<void> {
    if (!loaded) return;
    setBusy("describe");
    setError(null);
    try {
      const result = await describeSheet(loaded.imageBase64, loaded.mediaType);
      setDescribed(result);
      onDescription(result.description);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sheet-pipeline">
      {!live ? (
        <p className="sheet-pipeline__offline">
          This tab needs the real backend. Run <code>npm run dev</code> rather than a fixture
          scenario. Both steps below make a paid API call.
        </p>
      ) : null}

      <ol className="sheet-pipeline__steps">
        <li className="sheet-pipeline__step">
          <div className="sheet-pipeline__step-head">
            <span className="sheet-pipeline__step-label">2 · Generate the avatar</span>
            <span className="sheet-pipeline__cost">paid image call</span>
          </div>
          <p className="sheet-pipeline__hint">
            Takes the prompt above, runs Mentic&rsquo;s doctrine over it, wraps the result in the
            three-panel character-sheet layout and sends it to Nano Banana Pro. Or skip the
            render and upload an avatar you already made in Mentic.
          </p>
          <div className="sheet-pipeline__actions">
            <button
              type="button"
              className="sheet-pipeline__button"
              disabled={!canGenerate}
              onClick={() => void onGenerate()}
            >
              {busy === "sheet" ? "Rendering…" : "Generate sheet"}
            </button>
            <button
              type="button"
              className="sheet-pipeline__button"
              disabled={disabled || busy !== null}
              onClick={() => fileInput.current?.click()}
            >
              Upload a sheet
            </button>
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              accept="image/png,image/jpeg,image/webp,image/gif"
              aria-label="Upload a character sheet"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFile(file);
                // Reset so choosing the same file twice fires a change event both times.
                event.target.value = "";
              }}
            />
          </div>
        </li>

        {loaded ? (
          <li className="sheet-pipeline__step">
            <div className="sheet-pipeline__step-head">
              <span className="sheet-pipeline__step-label">The avatar</span>
              <span className="sheet-pipeline__cost">
                {loaded.source === "uploaded" ? "uploaded" : sheet?.model}
              </span>
            </div>
            <img
              className="sheet-pipeline__image"
              src={`data:${loaded.mediaType};base64,${loaded.imageBase64}`}
              alt="The rendered character reference sheet"
            />
            {sheet ? (
              <details className="sheet-pipeline__prompts">
                <summary>What was sent to the image model</summary>
                <p className="sheet-pipeline__prompt-label">The doctrine wrote this identity</p>
                <pre className="sheet-pipeline__prompt">{sheet.authoredPrompt}</pre>
                <p className="sheet-pipeline__prompt-label">Wrapped in the sheet layout</p>
                <pre className="sheet-pipeline__prompt">{sheet.sheetPrompt}</pre>
              </details>
            ) : null}
          </li>
        ) : null}

        <li className="sheet-pipeline__step">
          <div className="sheet-pipeline__step-head">
            <span className="sheet-pipeline__step-label">3 · Describe the avatar</span>
            <span className="sheet-pipeline__cost">paid vision call</span>
          </div>
          <p className="sheet-pipeline__hint">
            Runs Mentic&rsquo;s own describe prompt over the avatar above. The model looks at the
            rendered image and writes the person down from scratch. What it writes is the
            paragraph that reaches the video model, and it is the only thing the nine checks
            ever grade.
          </p>
          <button
            type="button"
            className="sheet-pipeline__button"
            disabled={!canDescribe}
            onClick={() => void onDescribe()}
          >
            {busy === "describe" ? "Reading the sheet…" : "Describe this person"}
          </button>
        </li>

        {described ? (
          <li className="sheet-pipeline__step">
            <div className="sheet-pipeline__step-head">
              <span className="sheet-pipeline__step-label">4 · What gets graded</span>
              <span className="sheet-pipeline__cost">
                {described.model} · {described.description.length} char
              </span>
            </div>
            <p className="sheet-pipeline__description">{described.description}</p>
            {described.trimmed ? (
              <p className="sheet-pipeline__trimmed">
                The 900-character cap cut this. The prompt asks for one sentence under 400
                characters, so the model wrote past its own instruction and then past the
                store&rsquo;s limit.
              </p>
            ) : null}
            <p className="sheet-pipeline__hint">
              Written from the avatar, not from what you typed. Press Run to grade it against
              the nine checks.
            </p>
          </li>
        ) : null}
      </ol>

      {error ? (
        <p className="sheet-pipeline__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
