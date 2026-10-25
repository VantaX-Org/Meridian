import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppLoading from "../loading";

describe("app loading", () => {
  it("is busy and says Loading to assistive tech", () => {
    const { container } = render(<AppLoading />);
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading the page");
  });
});
