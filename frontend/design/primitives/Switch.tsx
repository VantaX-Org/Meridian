import type { ButtonHTMLAttributes } from "react";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role" | "aria-checked" | "children"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}

/** On/off toggle. A native button, so Space and Enter activate it. */
export function Switch({ checked, onCheckedChange, label, className, ...rest }: SwitchProps) {
  return (
    <button
      {...rest}
      type="button"
      role="switch"
      aria-checked={checked}
      className={className ? `m-switch ${className}` : "m-switch"}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="m-switch-track" aria-hidden="true"><span className="m-switch-thumb" /></span>
      <span className="m-text-body">{label}</span>
    </button>
  );
}
