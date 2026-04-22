/**
 * Aurora form primitives — WS2.
 *
 * `<Field>` composes label + control + helper/error into a single accessible
 * unit. `<Input>`, `<Textarea>`, `<Select>` are thin controlled wrappers over
 * native HTML elements, styled via aurora-components.css.
 *
 * For a typeahead / listbox, use `<Combobox>` (separate file).
 */

"use client";

import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { clsx } from "./internal";

/* ---------------------------------------------------------------- Field --- */

export interface FieldProps {
  label?: ReactNode;
  /** Optional helper text shown below the control. */
  helper?: ReactNode;
  /** If present, renders `helper` slot in the danger tone. */
  error?: string;
  /** Required marker next to the label. */
  required?: boolean;
  children: (ids: { controlId: string; helperId?: string }) => ReactNode;
  className?: string;
}

export function Field({
  label,
  helper,
  error,
  required,
  children,
  className,
}: FieldProps) {
  const controlId = useId();
  const helperId =
    helper !== undefined || error !== undefined
      ? `${controlId}-helper`
      : undefined;
  const tone = error ? "danger" : undefined;
  const helperText = error ?? helper;
  return (
    <div className={clsx("aurora-field", className)}>
      {label !== undefined ? (
        <label className="aurora-field__label" htmlFor={controlId}>
          {label}
          {required ? (
            <span
              aria-hidden
              style={{
                color: "var(--aurora-status-danger-500)",
                marginLeft: 2,
              }}
            >
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children({ controlId, helperId })}
      {helperText !== undefined ? (
        <span
          className="aurora-field__helper"
          id={helperId}
          data-tone={tone}
          role={error ? "alert" : undefined}
        >
          {helperText}
        </span>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Input --- */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <input
      className={clsx("aurora-input", "aurora-focus-ring", className)}
      data-invalid={invalid ? "true" : undefined}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------- Textarea --- */

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={clsx("aurora-textarea", "aurora-focus-ring", className)}
      data-invalid={invalid ? "true" : undefined}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

/* --------------------------------------------------------------- Select --- */

export interface SelectOption<TValue extends string = string> {
  value: TValue;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<TValue extends string = string>
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  options: ReadonlyArray<SelectOption<TValue>>;
  invalid?: boolean;
  /** Placeholder option rendered as an empty first item. */
  placeholder?: string;
  value?: TValue;
  onValueChange?: (value: TValue) => void;
}

export function Select<TValue extends string = string>({
  options,
  invalid,
  placeholder,
  value,
  onValueChange,
  className,
  ...rest
}: SelectProps<TValue>) {
  return (
    <select
      className={clsx("aurora-select", "aurora-focus-ring", className)}
      data-invalid={invalid ? "true" : undefined}
      aria-invalid={invalid || undefined}
      value={value}
      onChange={(event) => onValueChange?.(event.target.value as TValue)}
      {...rest}
    >
      {placeholder !== undefined ? (
        <option value="" disabled hidden={value != null && value !== ""}>
          {placeholder}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
