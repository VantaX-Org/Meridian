import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Status } from "./Status";

describe("Status variant dot", () => {
  it("draws the verdict as its tone's dot and the same short label, with no pill fill, for a phone column", () => {
    const { container } = render(<Status kind="verdict" value="no_go" variant="dot" />);
    const el = container.firstElementChild!;
    expect(el).toHaveClass("m-status-dot");
    expect(el).not.toHaveClass("m-pill");
    expect(el).toHaveAttribute("data-tone", "no-go");
    expect(el).toHaveTextContent(/^No-go$/);
    expect(el.querySelector(".m-pill-dot")).not.toBeNull();
  });

  it("keeps the soft pill by default", () => {
    const { container } = render(<Status kind="verdict" value="at_risk" />);
    expect(container.firstElementChild).toHaveClass("m-pill", "m-pill-at-risk");
  });
});
