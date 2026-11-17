import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "./test-utils";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { MigrationRun } from "./MigrationRun";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/load/runs/mig-0002?fixture=1");
});
afterEach(() => undo());

describe("MigrationRun", () => {
  it("renders its title and real rows in fixture mode", async () => {
    renderScreen(<MigrationRun id="mig-0002" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Run mig-0002" })).toBeTruthy();
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });
});
