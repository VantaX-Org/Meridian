/** A SAP field: the technical code in mono, its plain description beside it. */
export function FieldChip({ code, description, wrap }: { code: string; description?: string; /** Let a long code, such as a URL, wrap instead of running on one line. */ wrap?: boolean }) {
  return (
    <span className="mx-fieldchip" data-wrap={wrap ? "" : undefined}>
      <code className="mx-code">{code}</code>
      {description ? <span title={description}>{description}</span> : null}
    </span>
  );
}
