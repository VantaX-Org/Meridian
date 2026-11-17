/** Read-only text such as rule YAML. Focusable so it scrolls by keyboard; `label` names it for a screen reader. */
export function CodeView({ text, label }: { text: string; label: string }) {
  return <pre className="mx-code mx-codeview" tabIndex={0} aria-label={label}>{text}</pre>;
}

/** A unified diff, one line per row. Added and removed lines carry a tone and keep their + or - marker. */
export function DiffView({ diff, label }: { diff: string; label: string }) {
  return (
    <pre className="mx-code mx-codeview" tabIndex={0} aria-label={label}>
      {diff.split("\n").map((l, i) => (
        <span key={i} className="mx-diff-line" data-kind={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx"}>{l}{"\n"}</span>
      ))}
    </pre>
  );
}
