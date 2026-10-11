import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DesignGalleryPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

describe("design gallery", () => {
  it("shows the composite primitives in both themes", () => {
    render(<DesignGalleryPage />);
    expect(screen.getAllByText("Danger notice.")).toHaveLength(2);
    expect(screen.getAllByText("Card body.")).toHaveLength(2);
    expect(screen.getAllByText("Designed fresh-install sentence.")).toHaveLength(2);
  });
});
