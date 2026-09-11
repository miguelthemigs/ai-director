export type SectionLabelProps = {
  children: React.ReactNode;
  as?: "h2" | "h3";
};

/**
 * Uppercase 12px Archivo at `--tr-caps`, `--ink-3`, with the 1px seam beneath. The only heading
 * treatment in the product (design doc §5 "Shared").
 */
export function SectionLabel({ children, as = "h2" }: SectionLabelProps): React.JSX.Element {
  const Tag = as;
  return <Tag className="section-label">{children}</Tag>;
}
