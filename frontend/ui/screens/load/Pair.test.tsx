import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "./test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { Pair } from "./Pair";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/load/compare/pair-0001?fixture=1");
});
afterEach(() => undo());

describe("Pair", () => {
  it("renders its title and real rows in fixture mode", async () => {
    renderScreen(<Pair id="pair-0001" />);
    expect(await screen.findByRole("heading", { level: 1, name: "ECC production to S/4HANA quality" })).toBeTruthy();
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
    expect(screen.getByText("Source DQS")).toBeTruthy();
    expect(screen.getByText("Projected target DQS")).toBeTruthy();
    expect(screen.getByText("Actual target DQS")).toBeTruthy();
  });
});
