import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PREVIEW_SOURCE_HINT, PreviewBadge } from "../preview-badge";

describe("PreviewBadge", () => {
  it("renders nothing when every source is verified", () => {
    const { container } = render(<PreviewBadge sources={[]} />);
    expect(container).toBeEmptyDOMElement();
    const none = render(<PreviewBadge />);
    expect(none.container).toBeEmptyDOMElement();
  });

  it("names the unverified sources and carries the tooltip text", () => {
    render(<PreviewBadge sources={[{ source: "VLCVEHICLE", reason: "r" }, { source: "MDGMATERIAL", reason: "r" }]} />);
    const badge = screen.getByLabelText(`Preview: VLCVEHICLE, MDGMATERIAL. ${PREVIEW_SOURCE_HINT}`);
    expect(badge).toHaveTextContent("Preview");
    expect(badge).toHaveAttribute("tabindex", "0");
    expect(PREVIEW_SOURCE_HINT).toBe("Source name not yet verified against SAP; extraction may fail");
  });
});
