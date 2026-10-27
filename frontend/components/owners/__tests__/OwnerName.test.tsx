import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OwnerName } from "../OwnerName";

describe("OwnerName", () => {
  it("shows the name whatever the list's state", () => {
    render(<OwnerName name="Ann Lead" status="error" />);
    expect(screen.getByText("Ann Lead")).toBeInTheDocument();
  });

  it("says Not set only when the owners list loaded and names nobody", () => {
    const { rerender } = render(<OwnerName name={null} status="ready" />);
    expect(screen.getByText("Not set")).toBeInTheDocument();
    rerender(<OwnerName name={null} status="error" />);
    expect(screen.queryByText("Not set")).toBeNull();
    expect(screen.getByText("Owner unavailable")).toHaveAttribute("title", "The list of owners could not be loaded");
    rerender(<OwnerName name={null} status="loading" />);
    expect(screen.queryByText("Not set")).toBeNull();
    expect(screen.queryByText("Owner unavailable")).toBeNull();
  });
});
