// frontend/design/primitives/Select.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Select } from "./Select";

describe("Select", () => {
  it("shows the selected option's label, not its raw value, on the closed trigger", () => {
    render(
      <Select
        value="pct_90"
        onValueChange={() => {}}
        options={[
          { value: "pct_90", label: "90th percentile" },
          { value: "pct_95", label: "95th percentile" },
        ]}
      />,
    );
    expect(screen.getByText("90th percentile")).toBeInTheDocument();
    expect(screen.queryByText("pct_90")).not.toBeInTheDocument();
  });
});
