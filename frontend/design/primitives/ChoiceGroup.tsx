"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";

/**
 * One toggle pill (`.m-choice`): `aria-pressed` carries the state and the pressed pill wears the accent tint. A single
 * on/off filter ("Customer extensions only") uses it alone; a set of them is a `ChoiceGroup`.
 */
export function Choice({ pressed, className, type = "button", ...rest }: { pressed: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed">) {
  return <button type={type} aria-pressed={pressed} className={clsx("m-choice", className)} {...rest} />;
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
  disabled?: boolean;
}

interface ChoiceGroupBase<T extends string> {
  /** Names the group (`aria-label`); shown before the pills when `showLabel`. */
  label: string;
  showLabel?: boolean;
  /** Extra classes on the shown label, e.g. a min width so stacked rows line up. */
  labelClassName?: string;
  options: readonly ChoiceOption<T>[];
  disabled?: boolean;
  className?: string;
}

export type ChoiceGroupProps<T extends string> = ChoiceGroupBase<T> & (
  | { multiple?: false; value: T; onChange: (value: T) => void }
  | { multiple: true; value: readonly T[]; onChange: (value: T[]) => void }
);

/**
 * A row of toggle pills for one filter or mode: a `group` of buttons, each `aria-pressed`. Single choice by default
 * (pressing a pill selects it); `multiple` toggles each value in and out of the list. The pressed state is the accent
 * (interaction), never a status hue.
 */
export function ChoiceGroup<T extends string>(props: ChoiceGroupProps<T>) {
  const { label, showLabel = false, labelClassName, options, disabled, className } = props;
  const isOn = (v: T) => (props.multiple ? props.value.includes(v) : props.value === v);
  const press = (v: T) => {
    if (props.multiple) props.onChange(props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
    else props.onChange(v);
  };
  return (
    <div role="group" aria-label={label} className={clsx("flex flex-wrap items-center gap-2", className)}>
      {showLabel ? <span className={clsx("m-text-meta m-ink-3", labelClassName)} aria-hidden="true">{label}</span> : null}
      {options.map((o) => (
        <Choice key={o.value} pressed={isOn(o.value)} aria-label={o.ariaLabel} disabled={disabled || o.disabled} onClick={() => press(o.value)}>
          {o.label}
        </Choice>
      ))}
    </div>
  );
}
