import { useCallback, useEffect, useRef, useState } from "react";
import {
  avatarImageUrl,
  describeSheet,
  generateSheet,
  listAvatars,
  splitDataUrl,
  uploadSheet,
  type AvatarRecord,
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

type Loaded = {
  imageBase64: string;
  mediaType: string;
  source: "generated" | "uploaded" | "stored";
  /** The stored record, when there is one. Null only if the server has no avatar store. */
  id: string | null;
};

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
  const [gallery, setGallery] = useState<AvatarRecord[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  /* Every avatar this server has ever rendered or been given. Loaded on mount and refreshed
     after each write, so a sheet that was paid for is still reachable after a reload, a
     dev-server restart, or the browser being closed. A gallery that quietly fails to load
     is not worth an error banner over the pipeline itself. */
  const refreshGallery = useCallback(() => {
    if (!live) return;
    listAvatars()
      .then(setGallery)
      .catch(() => setGallery([]));
  }, [live]);

  useEffect(refreshGallery, [refreshGallery]);

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
      setLoaded({
        imageBase64: result.imageBase64,
        mediaType: result.mediaType,
        source: "generated",
        id: result.id,
      });
      refreshGallery();
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
      setLoaded({ ...split, source: "uploaded", id: null });
      // Stored too, so an uploaded sheet joins the gallery instead of living only in this
      // tab until the next reload. Failing to store it must not block describing it.
      uploadSheet(split.imageBase64, split.mediaType)
        .then((stored) => {
          setLoaded({ ...split, source: "uploaded", id: stored.id });
          refreshGallery();
        })
        .catch(() => {});
    };
    reader.readAsDataURL(file);
  }

  /** Reopen an avatar from the gallery. The bytes come back from the store rather than from
   *  memory, which is the whole point of having one. */
  async function onPick(record: AvatarRecord): Promise<void> {
    setError(null);
    setSheet(null);
    setDescribed(null);
    try {
      const res = await fetch(avatarImageUrl(record.id));
      if (!res.ok) throw new Error(`could not load that avatar (status ${res.status})`);
      const buffer = await res.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
      setLoaded({
        imageBase64: btoa(binary),
        mediaType: record.mediaType,
        source: "stored",
        id: record.id,
      });
      if (record.description) {
        setDescribed({
          description: record.description,
          raw: record.description,
          trimmed: record.descriptionTrimmed ?? false,
          model: record.describeModel ?? "unknown",
        });
        onDescription(record.description);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDescribe(): Promise<void> {
    if (!loaded) return;
    setBusy("describe");
    setError(null);
    try {
      const result = await describeSheet(loaded.imageBase64, loaded.mediaType, loaded.id);
      setDescribed(result);
      onDescription(result.description);
      refreshGallery();
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

      {/* Every avatar on disk. This exists because a rendered sheet is a paid artefact that
          used to live only in React state: gone on a reload, gone on a dev-server restart,
          and indistinguishable from a render that never happened. */}
      {live && gallery.length > 0 ? (
        <section className="avatar-gallery" aria-label="Saved avatars">
          <div className="avatar-gallery__head">
            <span className="avatar-gallery__label">Your avatars</span>
            <span className="avatar-gallery__count tnum">{gallery.length} saved</span>
          </div>
          <ul className="avatar-gallery__grid">
            {gallery.map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  className="avatar-gallery__item"
                  data-selected={loaded?.id === record.id || undefined}
                  onClick={() => void onPick(record)}
                >
                  <img
                    className="avatar-gallery__thumb"
                    src={avatarImageUrl(record.id)}
                    alt={record.seedDescription ?? `Avatar rendered ${record.createdAt}`}
                    loading="lazy"
                  />
                  <span className="avatar-gallery__meta">
                    {/* Whether this one has been described yet is the only status worth a
                        badge: an avatar with no description has nothing to grade. */}
                    <span
                      className="avatar-gallery__state"
                      data-described={record.description ? true : undefined}
                    >
                      {record.description ? "described" : "not described"}
                    </span>
                    <span className="avatar-gallery__when tnum">
                      {new Date(record.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="avatar-gallery__where">
            Saved to <code>data/avatars/</code>. Click one to reopen it.
          </p>
        </section>
      ) : null}
    </div>
  );
}
