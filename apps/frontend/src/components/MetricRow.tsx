export type MetricRowProps = {
  label: string;
  value: string;
  unit?: string;
  mono?: boolean;
};

/**
 * One label/value pair in the inspector (design doc §5 "Architecture screen"). Every value here is
 * a string the caller has already decided how to phrase — including "not measured" — so this
 * component never invents a fallback of its own.
 */
export function MetricRow({ label, value, unit, mono }: MetricRowProps): React.JSX.Element {
  return (
    <div className="metric-row">
      <span className="metric-row__label">{label}</span>
      <span className={mono ? "metric-row__value tnum" : "metric-row__value"}>
        {value}
        {unit ? <span className="metric-row__unit">{unit}</span> : null}
      </span>
    </div>
  );
}
