/** A SAP field: the technical code in mono, its plain description beside it. */
export function FieldChip({ code, description }: { code: string; description?: string }) {
  return (
    <span className="mx-fieldchip">
      <code className="mx-code">{code}</code>
      {description ? <span title={description}>{description}</span> : null}
    </span>
  );
}
