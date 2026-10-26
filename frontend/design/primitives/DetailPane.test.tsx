import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailPane } from "./DetailPane";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

describe("DetailPane", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the detail in place when wide, and the empty state with nothing picked", () => {
    stubMatchMedia(false);
    const { rerender } = render(<DetailPane open={false} onOpenChange={vi.fn()} title="Record" label="Record" empty={<p>Pick one</p>}>{null}</DetailPane>);
    expect(screen.getByRole("region", { name: "Record" })).toHaveTextContent("Pick one");
    rerender(<DetailPane open={false} onOpenChange={vi.fn()} title="Record" label="Record">detail body</DetailPane>);
    expect(screen.getByRole("region", { name: "Record" })).toHaveTextContent("detail body");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens as a sheet when narrow, only while open", () => {
    stubMatchMedia(true);
    const { rerender } = render(<DetailPane open={false} onOpenChange={vi.fn()} title="Record">detail body</DetailPane>);
    expect(screen.queryByText("detail body")).toBeNull();
    rerender(<DetailPane open onOpenChange={vi.fn()} title="Record">detail body</DetailPane>);
    expect(screen.getByRole("dialog")).toHaveTextContent("detail body");
  });
});
