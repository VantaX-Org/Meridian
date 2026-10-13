// frontend/design/primitives/Field.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./Field";

describe("Field", () => {
  it("associates its label with a raw input child", () => {
    render(
      <Field label="Name">
        <input value="" onChange={() => {}} />
      </Field>,
    );
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("marks the control invalid and points aria-describedby at the error text", () => {
    render(
      <Field label="Name" error="Name is required">
        <input value="" onChange={() => {}} />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent("Name is required");
  });

  it("leaves the control valid when there is no error", () => {
    render(
      <Field label="Name">
        <input value="" onChange={() => {}} />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });
});
