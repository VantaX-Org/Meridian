import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MeridianMark } from "../components/meridian/icons";

describe("MeridianMark", () => {
  it("renders the two-tone variant without any literal hex colours", () => {
    const { container } = render(<MeridianMark />);
    expect(container.innerHTML).not.toContain("#");
  });

  it("renders the mono variant without any literal hex colours", () => {
    const { container } = render(<MeridianMark variant="mono" />);
    expect(container.innerHTML).not.toContain("#");
  });

  it("two-tone draws two paths with distinct strokes", () => {
    const { container } = render(<MeridianMark />);
    const strokes = [...container.querySelectorAll("path")].map((p) => p.getAttribute("stroke"));
    expect(strokes).toHaveLength(2);
    expect(new Set(strokes).size).toBe(2);
  });

  it("does not accept the removed tile variant", () => {
    // @ts-expect-error "tile" was removed from the variant union
    render(<MeridianMark variant="tile" />);
  });
});
