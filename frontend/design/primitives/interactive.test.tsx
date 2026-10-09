import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

describe("interactive primitives", () => {
  it("Button fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByText("Save"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("IconButton requires an aria-label", () => {
    render(<IconButton aria-label="Close" onClick={() => {}} />);
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });
});
