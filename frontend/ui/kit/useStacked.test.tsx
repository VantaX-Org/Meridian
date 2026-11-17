import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStacked } from "./useStacked";

function Probe() { return <p>{useStacked() ? "stacked" : "wide"}</p>; }

describe("useStacked", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("is false without matchMedia", () => {
    render(<Probe />);
    expect(screen.getByText("wide")).toBeTruthy();
  });
  it("follows the media query", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    render(<Probe />);
    expect(screen.getByText("stacked")).toBeTruthy();
  });
});
