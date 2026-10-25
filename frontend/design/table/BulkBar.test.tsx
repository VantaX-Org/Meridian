import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BulkBar } from "./BulkBar";

describe("BulkBar", () => {
  it("renders nothing with no selection", () => {
    const { container } = render(<BulkBar count={0} actions={<button type="button">Assign</button>} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sits above the Ask launcher and the attribution below lg, and wraps rather than run under them", () => {
    render(<BulkBar count={3} actions={<button type="button">Assign</button>} />);
    const bar = screen.getByTestId("bulk-bar");
    expect(bar).toHaveTextContent("3 selected");
    // 64px, the toasts' offset above the launcher (fixed bottom-4, about 40px tall); back to 16px at lg
    expect(bar).toHaveClass("sticky", "bottom-16", "lg:bottom-4");
    expect(bar.firstElementChild).toHaveClass("flex-wrap", "max-w-full");
  });
});
