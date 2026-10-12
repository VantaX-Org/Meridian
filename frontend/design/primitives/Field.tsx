"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { Field as BaseField } from "@base-ui/react/field";
import { Input } from "./Input";

type ControlProps = { id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string };

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  const generatedId = useId();
  // Base UI's Field.Label only gets htmlFor from a registered Field.Control; for raw
  // <input>/<textarea> children we generate an id and wire it up ourselves.
  const control = isValidElement<ControlProps>(children) && (typeof children.type === "string" || children.type === Input) ? children : undefined;
  const controlId = control ? control.props.id ?? generatedId : undefined;
  const content = control
    ? cloneElement<ControlProps>(control as ReactElement<ControlProps>, { id: controlId, ...(error ? { "aria-invalid": true, "aria-describedby": `${controlId}-error` } : {}) })
    : children;
  return (
    <BaseField.Root className="flex flex-col gap-1.5">
      <BaseField.Label htmlFor={controlId} className="m-field-label">
        {label}
      </BaseField.Label>
      {content}
      {/* match: the caller decides validity; Base UI otherwise only shows errors for its own Field.Control */}
      {error && (
        <BaseField.Error match id={controlId ? `${controlId}-error` : undefined} className="m-field-error">
          {error}
        </BaseField.Error>
      )}
    </BaseField.Root>
  );
}
