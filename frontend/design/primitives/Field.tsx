"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { Field as BaseField } from "@base-ui/react/field";

type ControlProps = { id?: string };

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  const generatedId = useId();
  // Base UI's Field.Label only gets htmlFor from a registered Field.Control; for raw
  // <input>/<textarea> children we generate an id and wire it up ourselves.
  const control = isValidElement<ControlProps>(children) && typeof children.type === "string" ? children : undefined;
  const controlId = control ? control.props.id ?? generatedId : undefined;
  const content = control
    ? cloneElement<ControlProps>(control as ReactElement<ControlProps>, { id: controlId })
    : children;
  return (
    <BaseField.Root className="flex flex-col gap-1">
      <BaseField.Label htmlFor={controlId} className="text-[12px] leading-4" style={{ color: "var(--m-ink-2)" }}>
        {label}
      </BaseField.Label>
      {content}
      {error && (
        <BaseField.Error className="text-[12px] leading-4" style={{ color: "var(--m-critical)" }}>
          {error}
        </BaseField.Error>
      )}
    </BaseField.Root>
  );
}
