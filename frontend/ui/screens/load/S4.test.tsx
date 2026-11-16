import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "./test-utils";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { S4 } from "./S4";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/n/load/s4?fixture=1");
});
afterEach(() => undo());

describe("S4", () => {
  it("renders its title and real rows in fixture mode", async () => {
    renderScreen(<S4 />);
    expect(await screen.findByRole("heading", { level: 1, name: "S/4 readiness" })).toBeTruthy();
    expect((await screen.findAllByRole("button")).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });
});
