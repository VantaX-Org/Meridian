import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MeridianMark } from "../components/meridian/icons";

describe("MeridianMark", () => {
  it("renders the tile variant without any literal hex colours", () => {
    const { container } = render(<MeridianMark />);
    expect(container.innerHTML).not.toContain("#");
  });

  it("renders the mono variant without any literal hex colours", () => {
    const { container } = render(<MeridianMark variant="mono" />);
    expect(container.innerHTML).not.toContain("#");
  });
});
