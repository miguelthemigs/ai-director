import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  AVATAR_FIELDS,
  assembleDescription,
  isFieldVisible,
  randomizeFields,
  resolveSuggestions,
  type AvatarField,
  type AvatarFieldValues,
} from "../domain/avatarFields.js";
import { SheetPipeline } from "./SheetPipeline.js";
import { T } from "../motion/tokens.js";
import { useMotionPrefs } from "../motion/useMotionPrefs.js";

export type AvatarComposerProps = {
  /** Called with the text that is to be graded. The composer owns that text: the two tabs hold
   *  two independent drafts, and which one is live depends on the active tab, so lifting it into
   *  the parent would mean either syncing state during render (which updates a component while
   *  another is rendering) or an effect whose only job is to copy a value downward and back. */
  onSubmit: (description: string, avatarId: string | null) => void;
  disabled: boolean;
  maxChars: number;
  /** False in fixture mode. The Pipeline tab's two steps both spend real money, so with no
   *  backend it says so rather than faking a character sheet. */
  live?: boolean;
};

type Tab = "build" | "paste";

/**
 * The ORDER is load-bearing rather than cosmetic: each panel's slide offset is its own index
 * minus the active index, which is what makes the transition spatially honest — the panel on
 * the right always enters from the right and leaves to the right, whichever direction you
 * switch, with no "which way did we just come from" state to keep in sync. Lifted from
 * Mentic's own `actor-step.tsx`, whose comment makes the same point.
 */
const TABS = [
  { value: "build", label: "Build an avatar" },
  { value: "paste", label: "Paste a description" },
] as const satisfies readonly { value: Tab; label: string }[];

/** Small on purpose: this is a tab switch inside a panel, not a page transition. */
const PANEL_SLIDE_PX = 24;

function checkLabel(checkId: string): string {
  return checkId.replaceAll("_", " ");
}

function GuidedField({
  field,
  values,
  onChange,
  disabled,
}: {
  field: AvatarField;
  values: AvatarFieldValues;
  onChange: (next: AvatarFieldValues) => void;
  disabled: boolean;
}): React.JSX.Element {
  const suggestions = resolveSuggestions(field, values);
  const inputId = `avatar-field-${field.key}`;

  const header = (
    <div className="avatar-field__header">
      <label className="avatar-field__label" htmlFor={inputId}>
        {field.label}
      </label>
      {field.notInMentic ? (
        <span className="avatar-field__flag" title="No field like this exists in Mentic today">
          not in Mentic
        </span>
      ) : null}
      {field.checks.length > 0 ? (
        <span className="avatar-field__checks">{field.checks.map(checkLabel).join(" · ")}</span>
      ) : null}
    </div>
  );

  // Free text spans the whole grid and drops the suggestions menu: it exists for whatever the
  // structured fields cannot say, so a fixed list would only narrow it back down.
  if (field.freeText) {
    return (
      <div className="avatar-field avatar-field--wide">
        {header}
        <textarea
          id={inputId}
          className="avatar-field__textarea"
          value={values[field.key] ?? ""}
          disabled={disabled}
          placeholder="Anything the fields above cannot say."
          onChange={(event) => onChange({ ...values, [field.key]: event.target.value })}
        />
      </div>
    );
  }

  return (
    <div className="avatar-field">
      {header}
      <div className="avatar-field__row">
        <input
          id={inputId}
          className="avatar-field__input"
          value={values[field.key] ?? ""}
          disabled={disabled}
          placeholder="Type, or pick one"
          onChange={(event) => onChange({ ...values, [field.key]: event.target.value })}
        />
        {/*
          A plain native <select>, not a listbox widget. This is not a form field holding a
          value, it is a pick-to-insert menu: after every pick its own value resets to the
          placeholder. Mentic reached the same conclusion the hard way — a controlled listbox
          fought that reset and left the page's scroll locked.
        */}
        <select
          className="avatar-field__pick"
          value=""
          disabled={disabled}
          aria-label={`Suggestions for ${field.label}`}
          onChange={(event) => {
            if (!event.target.value) return;
            onChange({ ...values, [field.key]: event.target.value });
            event.target.value = "";
          }}
        >
          <option value="" disabled>
            +
          </option>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion}>
              {suggestion}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * The pre-run composer: the avatar description, built either from Mentic's guided fields or
 * pasted whole.
 *
 * ── Which description this is ───────────────────────────────────────────────────────────
 * The one that reaches the VIDEO model. In Mentic that is `UgcActor.description`, the
 * paragraph spliced into every render prompt, not the brief that renders the character sheet.
 * The sheet is never sent anywhere (seedance2 refuses a human likeness in any input image), so
 * this paragraph is the only thing carrying the person into a video, and it is the whole
 * reason this product exists. The Direct tab is for pasting a real one straight out of Mentic;
 * the Guided tab is for building one from the same fields Mentic offers.
 *
 * Both panels stay mounted, which is what keeps the panel from collapsing mid-transition and
 * what lets a draft survive a tab switch. Only the ACTIVE panel's text is ever submitted.
 */
export function AvatarComposer({
  onSubmit,
  disabled,
  maxChars,
  live = true,
}: AvatarComposerProps): React.JSX.Element {
  const { t, v, reduce } = useMotionPrefs();
  const [tab, setTab] = useState<Tab>("build");
  const [fields, setFields] = useState<AvatarFieldValues>({});
  const [direct, setDirect] = useState("");
  /** What the DESCRIBE step wrote. Separate from `direct` because it is not something the
   *  user typed: it is the pipeline's output, and overwriting their pasted draft with it
   *  would lose work they did by hand. */
  const [pipelined, setPipelined] = useState("");
  /** The stored avatar `pipelined` was read off, when there is one. Kept beside the text
   *  rather than derived from it, because it is what selects Repairer v2 and the two must
   *  never disagree: a description from the Pipeline tab carries its avatar, and a
   *  description typed into the Direct tab carries none because it belongs to none. */
  const [pipelinedAvatarId, setPipelinedAvatarId] = useState<string | null>(null);

  const assembled = useMemo(() => assembleDescription(fields), [fields]);
  const anyFieldSet = Object.values(fields).some((entry) => (entry ?? "").trim().length > 0);

  // The single source of the graded text. The character count, Run's disabled state and the
  // string that is actually submitted all read from this one expression, so they can never
  // disagree about what is about to be graded.
  // ── What is actually graded ────────────────────────────────────────────────────────
  // NOT `assembled`. The guided fields produce the prompt that GENERATES the avatar; they
  // are the input to the image, exactly as `assembleActorDescription` feeds
  // `actorSheetBrief` in Mentic. The graded artefact is what the vision model writes after
  // LOOKING at the rendered sheet, which in Mentic is `UgcActor.description` and here is
  // whatever `SheetPipeline` hands back. Submitting the assembled text would grade the
  // prompt instead of the product of the prompt, which is a different string about a
  // different thing, and it is the single easiest mistake to make about this pipeline.
  const activeText = tab === "build" ? pipelined : direct;
  // Only the Pipeline tab can name an avatar. Pasted text is a v1 run by construction, and
  // saying so is more useful than guessing which stored sheet it might have come from.
  const activeAvatarId = tab === "build" ? pipelinedAvatarId : null;

  const overLimit = activeText.length > maxChars;
  const canSubmit = !disabled && activeText.trim().length > 0 && !overLimit;

  const activeIndex = TABS.findIndex((entry) => entry.value === tab);
  const panelMotion = (index: number): Parameters<typeof motion.div>[0] => {
    const active = index === activeIndex;
    return {
      animate: v(
        {
          opacity: active ? 1 : 0,
          x: active ? 0 : (index - activeIndex) * PANEL_SLIDE_PX,
          filter: active ? "blur(0px)" : "blur(4px)",
        },
        { opacity: active ? 1 : 0 },
      ),
      transition: t(T.panelIn, T.fade),
    };
  };

  return (
    <form
      className="avatar-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit(activeText, activeAvatarId);
      }}
    >
      <div className="avatar-composer__tabs" role="tablist" aria-label="How to supply the description">
        {TABS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={tab === entry.value}
            className="avatar-composer__tab"
            data-selected={tab === entry.value || undefined}
            onClick={() => setTab(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <p className="avatar-composer__note">
        {tab === "build"
          ? "Describe the person, render the avatar, then grade the description the model writes back from that avatar. That last one is what reaches the video model."
          : "Paste a description straight out of Mentic to grade it on its own."}
      </p>

      <div className="avatar-composer__panels" data-reduce={reduce || undefined}>
        <motion.div
          className="avatar-composer__panel"
          data-active={tab === "build" || undefined}
          aria-hidden={tab !== "build"}
          {...panelMotion(0)}
        >
          <div className="avatar-composer__toolbar">
            <button
              type="button"
              className="avatar-composer__reroll"
              disabled={disabled}
              onClick={() => setFields((previous) => randomizeFields(previous))}
            >
              Surprise me
            </button>
            <button
              type="button"
              className="avatar-composer__clear"
              disabled={disabled || !anyFieldSet}
              onClick={() => setFields({})}
            >
              Clear
            </button>
          </div>

          <div className="avatar-fields">
            {AVATAR_FIELDS.filter((field) => isFieldVisible(field, fields)).map((field) => (
              <GuidedField
                key={field.key}
                field={field}
                values={fields}
                onChange={setFields}
                disabled={disabled}
              />
            ))}
          </div>

          <div className="avatar-preview">
            <span className="avatar-preview__label">The prompt that will generate the avatar</span>
            <p className="avatar-preview__text" data-empty={!anyFieldSet || undefined}>
              {anyFieldSet ? assembled : "Fill a field, or press Surprise me."}
            </p>
            {/* Said here, at the one place someone would otherwise assume the opposite.
                These words go to the image model. They are not the words that get graded. */}
            <p className="avatar-preview__caveat">
              This is what gets rendered, not what gets graded.
            </p>
          </div>

          <SheetPipeline
            seedDescription={anyFieldSet ? assembled : ""}
            onDescription={(description, avatarId) => {
              setPipelined(description);
              setPipelinedAvatarId(avatarId);
            }}
            disabled={disabled}
            live={live}
          />
        </motion.div>

        <motion.div
          className="avatar-composer__panel"
          data-active={tab === "paste" || undefined}
          aria-hidden={tab !== "paste"}
          {...panelMotion(1)}
        >
          <label className="avatar-field__label" htmlFor="description-composer-input">
            Description
          </label>
          <textarea
            id="description-composer-input"
            className="description-composer__input"
            placeholder="Paste the character description."
            value={direct}
            disabled={disabled}
            onChange={(event) => setDirect(event.target.value)}
          />
        </motion.div>
      </div>

      <div className="description-composer__footer">
        <span className="description-composer__count tnum" data-over={overLimit || undefined}>
          {activeText.length} / {maxChars} char
        </span>
        <button type="submit" className="description-composer__submit" disabled={!canSubmit}>
          Run
        </button>
      </div>
    </form>
  );
}
