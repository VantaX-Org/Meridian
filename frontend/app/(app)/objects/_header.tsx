/** One pressed chip per option; pressing the chosen one again clears the filter. */
export function FilterChips<T extends string>({ label, value, options, onChange }: {
  label: string; value: T | null; options: { value: T; label: string }[]; onChange: (next: T | null) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="m-text-meta m-ink-3">{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="m-choice"
          aria-pressed={value === o.value}
          onClick={() => onChange(value === o.value ? null : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
