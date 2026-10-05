import { useMemo, useState } from "react";
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

export type AvatarComposerProps = {
  /** Called with the description the describe step wrote and the avatar it was read off.
   *  Both always travel together: every run starts from an avatar, and the avatar is what
   *  lets the Repairer see the person (prompt v2). */
  onSubmit: (description: string, avatarId: string) => void;
  disabled: boolean;
  maxChars: number;
};

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
 * The pre-run composer. There is one way to start a run, and it is this one:
 *
 *   guided fields  ->  render (or upload) the avatar  ->  describe it  ->  Run
 *
 * ── Which description this is ───────────────────────────────────────────────────────────
 * The one that reaches the VIDEO model. In Mentic that is `UgcActor.description`, the
 * paragraph spliced into every render prompt, not the brief that renders the character sheet.
 * The sheet is never sent anywhere (seedance2 refuses a human likeness in any input image), so
 * this paragraph is the only thing carrying the person into a video, and it is the whole
 * reason this product exists.
 *
 * There used to be a second tab for pasting a description by hand. It was removed because a
 * pasted description belongs to no avatar, so the Repairer had nothing to look at and ran
 * blind (prompt v1), which is the prompt that fabricated details on run `bee3bcd6`.
 */
export function AvatarComposer({
  onSubmit,
  disabled,
  maxChars,
}: AvatarComposerProps): React.JSX.Element {
  const [fields, setFields] = useState<AvatarFieldValues>({});
  /** What the DESCRIBE step wrote, and the stored avatar it was read off. Kept together
   *  because the avatar is what selects Repairer v2, and the two must never disagree. */
  const [described, setDescribed] = useState<{ description: string; avatarId: string } | null>(
    null,
  );

  const assembled = useMemo(() => assembleDescription(fields), [fields]);
  const anyFieldSet = Object.values(fields).some((entry) => (entry ?? "").trim().length > 0);

  // ── What is actually graded ────────────────────────────────────────────────────────
  // NOT `assembled`. The guided fields produce the prompt that GENERATES the avatar; they
  // are the input to the image, exactly as `assembleActorDescription` feeds
  // `actorSheetBrief` in Mentic. The graded artefact is what the vision model writes after
  // LOOKING at the rendered sheet, which in Mentic is `UgcActor.description` and here is
  // whatever `SheetPipeline` hands back. Submitting the assembled text would grade the
  // prompt instead of the product of the prompt, which is a different string about a
  // different thing, and it is the single easiest mistake to make about this pipeline.
  const activeText = described?.description ?? "";

  const overLimit = activeText.length > maxChars;
  const canSubmit = !disabled && described !== null && activeText.trim().length > 0 && !overLimit;

  return (
    <form
      className="avatar-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && described) onSubmit(described.description, described.avatarId);
      }}
    >
      <p className="avatar-composer__note">
        Describe the person, render the avatar, then grade the description the model writes back
        from that avatar. That last one is what reaches the video model.
      </p>

      <div className="avatar-composer__body">
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
          onDescription={(description, avatarId) => setDescribed({ description, avatarId })}
          disabled={disabled}
        />
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
