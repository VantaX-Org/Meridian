import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "./test-utils";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { Wave } from "./Wave";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/n/load/waves/w-1?fixture=1");
});
afterEach(() => undo());

describe("Wave", () => {
  it("renders its title and real rows in fixture mode", async () => {
    renderScreen(<Wave id="w-1" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Wave 1: finance foundations" })).toBeTruthy();
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });
});
