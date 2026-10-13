// frontend/design/primitives/Field.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./Field";
import { Input } from "./Input";
import { Textarea } from "./Textarea";

describe("Field", () => {
  it("associates its label with a raw input child", () => {
    render(
      <Field label="Name">
        <input value="" onChange={() => {}} />
      </Field>,
    );
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("marks the control invalid and points it at the error text when `error` is set", () => {
    render(<Field label="Email" error="Enter a valid email address"><Input defaultValue="x" /></Field>);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Enter a valid email address");
  });

  it("does the same for a Textarea and a raw input", () => {
    render(
      <>
        <Field label="Notes" error="Too long"><Textarea defaultValue="x" /></Field>
        <Field label="Raw" error="Bad"><input defaultValue="x" /></Field>
      </>,
    );
    expect(screen.getByLabelText("Notes")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Raw")).toHaveAttribute("aria-invalid", "true");
  });

  it("sets neither attribute without an error", () => {
    render(<Field label="Name"><Input defaultValue="x" /></Field>);
    const input = screen.getByLabelText("Name");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });
});
