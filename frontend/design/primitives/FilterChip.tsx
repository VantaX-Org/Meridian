export interface FilterChipProps {
  label: string;
  value?: string;
  onRemove: () => void;
}

/** Removable filter chip. Filters appear as chips, never as "Showing X" sentences. */
export function FilterChip({ label, value, onRemove }: FilterChipProps) {
  return (
    <span className="m-chip m-text-meta">
      <span style={{ color: "var(--m-ink-3)" }}>{label}</span>
      {value !== undefined && <span className="font-medium">{value}</span>}
      <button type="button" className="m-chip-x" aria-label={`Remove filter ${label}`} onClick={onRemove}>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M1 1 7 7M7 1 1 7" />
        </svg>
      </button>
    </span>
  );
}
