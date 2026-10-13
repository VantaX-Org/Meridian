import { useCallback, useMemo, useState } from "react";

/**
 * A tiny schema helper for forms: a rule maps a string value to an error message, or undefined when it passes.
 * Every rule except `required` passes an empty value, so optional fields stay optional and `required` alone
 * decides whether empty is allowed. Messages are sentence case with no full stop (they sit under a control).
 */
export type Rule = (value: string) => string | undefined;

/** Rules per field; a field takes one rule or a list, checked in order, the first failure wins. */
export type Schema<V extends Record<string, string>> = { [K in keyof V]?: Rule | readonly Rule[] };

export type FormErrors<V extends Record<string, string>> = { [K in keyof V]?: string };

export interface FormResult<V extends Record<string, string>> {
  errors: FormErrors<V>;
  valid: boolean;
}

export function required(message = "Enter a value"): Rule {
  return (v) => (v.trim() === "" ? message : undefined);
}

export function email(message = "Enter a valid email address"): Rule {
  return (v) => (v.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? undefined : message);
}

export function url(message = "Enter a URL starting with https:// or http://"): Rule {
  return (v) => {
    if (v.trim() === "") return undefined;
    try {
      const u = new URL(v.trim());
      return (u.protocol === "https:" || u.protocol === "http:") && u.hostname ? undefined : message;
    } catch {
      return message;
    }
  };
}

/** A whole number from `min` to `max` inclusive. */
export function int(min: number, max: number, message?: string): Rule {
  const text = message ?? `Enter a whole number from ${min.toLocaleString()} to ${max.toLocaleString()}`;
  return (v) => {
    if (v.trim() === "") return undefined;
    if (!/^-?\d+$/.test(v.trim())) return text;
    const n = Number(v.trim());
    return n >= min && n <= max ? undefined : text;
  };
}

/** Between `min` and `max` characters. */
export function length(min: number, max: number, message?: string): Rule {
  const text = message ?? `Use ${min.toLocaleString()} to ${max.toLocaleString()} characters`;
  return (v) => (v === "" || (v.length >= min && v.length <= max) ? undefined : text);
}

export function pattern(re: RegExp, message: string): Rule {
  return (v) => (v === "" || re.test(v.trim()) ? undefined : message);
}

export function oneOf(options: readonly string[], message?: string): Rule {
  return (v) => (v === "" || options.includes(v) ? undefined : message ?? `Choose one of ${options.join(", ")}`);
}

/** Checks every field in the schema against the values. `valid` is true when no rule fails. */
export function validate<V extends Record<string, string>>(schema: Schema<V>, values: V): FormResult<V> {
  const errors: FormErrors<V> = {};
  for (const key of Object.keys(schema) as (keyof V)[]) {
    const rules = ([] as Rule[]).concat(schema[key] ?? []);
    for (const rule of rules) {
      const message = rule(values[key] ?? "");
      if (message) {
        errors[key] = message;
        break;
      }
    }
  }
  return { errors, valid: Object.keys(errors).length === 0 };
}

/**
 * Form state for a schema: `valid` gates the submit button; `error(name)` is the message to pass to `Field error`,
 * shown only once that field was left (blur) or a submit was attempted, so an untouched form is not a wall of red.
 */
export function useFormErrors<V extends Record<string, string>>(schema: Schema<V>, values: V) {
  const [touched, setTouched] = useState<Partial<Record<keyof V, boolean>>>({});
  const result = useMemo(() => validate(schema, values), [schema, values]);
  const blur = useCallback((name: keyof V) => setTouched((t) => (t[name] ? t : { ...t, [name]: true })), []);
  const touchAll = useCallback(() => setTouched(Object.fromEntries(Object.keys(schema).map((k) => [k, true])) as Partial<Record<keyof V, boolean>>), [schema]);
  const error = (name: keyof V): string | undefined => (touched[name] ? result.errors[name] : undefined);
  return { ...result, error, blur, touchAll };
}
