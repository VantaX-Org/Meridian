import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import type { Dependency } from "@/lib/api/v2/profile";
import { MinedDependencies } from "./MinedDependencies";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
const can = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/ui/screens/orphans/useCan", () => ({ useCan: () => () => can.allowed }));

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); can.allowed = true; window.history.replaceState(null, "", "/runs?fixture=1"); });
afterEach(() => undo());

const deps = [{ determinant: "MARA.MATKL", dependent: "MARA.MEINS", support: 0.981, violations: 12, accepted: false }] as unknown as Dependency[];
const view = (d: Dependency[] = deps) => renderWithQuery(<AletheiaProvider><ToastHost><MinedDependencies object="material_master" deps={d} onDone={() => undefined} /></ToastHost></AletheiaProvider>);

describe("mined dependencies", () => {
  it("confirms the rule before creating it", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Make it a rule" }));
    expect(await screen.findByText(/1 rule is created and 12 rows now break it/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create the rule" }));
    expect(await screen.findByText("Rule created")).toBeTruthy();
  });

  it("disables the action with a reason without the role", async () => {
    can.allowed = false;
    view();
    expect(((await screen.findByRole("button", { name: "Make it a rule" })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("You need the manage rules permission to create rules.")).toBeTruthy();
  });

  it("shows an empty state", async () => {
    view([]);
    expect(await screen.findByText("No dependencies found")).toBeTruthy();
  });
});
