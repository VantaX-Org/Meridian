"use client";

/** A search box with a clear button. */
export function Search({ value, onChange, label, clearLabel, placeholder }: { value: string; onChange: (v: string) => void; label: string; clearLabel: string; placeholder?: string }) {
  return (
    <div className="mx-search" role="search">
      <input type="search" className="mx-input" value={value} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} />
      {value ? <button type="button" className="mx-btn" data-variant="ghost" onClick={() => onChange("")}>{clearLabel}</button> : null}
    </div>
  );
}
