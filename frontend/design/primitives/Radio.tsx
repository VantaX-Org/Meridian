import type { InputHTMLAttributes } from "react";

/** Native radio with the design tokens applied and a visible label. Use inside `RadioGroup`. */
export function Radio({ label, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & { label: string }) {
  return (
    <label className="m-radio-row m-text-body">
      <input {...rest} type="radio" className="m-radio" />
      {label}
    </label>
  );
}

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Accessible radio group: a fieldset with a legend. Arrow keys move the choice natively. */
export function RadioGroup({ legend, name, value, onValueChange, options }: {
  legend: string;
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  options: RadioOption[];
}) {
  return (
    <fieldset className="flex flex-col gap-1" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="m-text-label mb-1" style={{ color: "var(--m-ink-3)" }}>{legend}</legend>
      {options.map((o) => (
        <Radio key={o.value} name={name} value={o.value} label={o.label} disabled={o.disabled} checked={value === o.value} onChange={() => onValueChange(o.value)} />
      ))}
    </fieldset>
  );
}
