import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../kit";
import { KitPage } from "../KitPage";

describe("KitPage", () => {
  it("renders a light and a dark pane", () => {
    render(<ToastProvider><KitPage /></ToastProvider>);
    expect(screen.getByTestId("pane-light")).toBeTruthy();
    expect(screen.getByTestId("pane-dark")).toBeTruthy();
  });
});
