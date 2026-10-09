import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("vitest harness", () => {
  it("renders with Testing Library and jest-dom matchers", () => {
    render(React.createElement("div", { "data-testid": "ping" }, "pong"));
    expect(screen.getByTestId("ping")).toHaveTextContent("pong");
  });
});
