export type DescriptionComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  maxChars: number;
};

/**
 * The pre-run textarea, character count, and submit control. Unmounts once the run starts — the
 * description becomes read-only text in `SpecimenView` thereafter (design doc §5).
 */
export function DescriptionComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  maxChars,
}: DescriptionComposerProps): React.JSX.Element {
  const overLimit = value.length > maxChars;

  return (
    <form
      className="description-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && value.trim().length > 0 && !overLimit) onSubmit();
      }}
    >
      <label className="description-composer__label" htmlFor="description-composer-input">
        Description
      </label>
      <textarea
        id="description-composer-input"
        className="description-composer__input"
        placeholder="Paste the character description."
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="description-composer__footer">
        <span className="description-composer__count tnum" data-over={overLimit || undefined}>
          {value.length} / {maxChars} char
        </span>
        <button
          type="submit"
          className="description-composer__submit"
          disabled={disabled || value.trim().length === 0 || overLimit}
        >
          Run
        </button>
      </div>
    </form>
  );
}
