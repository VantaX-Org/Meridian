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
});
