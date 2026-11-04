import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { AletheiaSurvivorship } from "../screens/AletheiaSurvivorship";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/aletheia-survivorship");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("verified survivorship", () => {
  it("shows counts per object and each pick with its checks, codes beside text", async () => {
    renderWithQuery(<AletheiaSurvivorship />);
    expect(await screen.findByTestId("surv-domain-material_master")).toBeInTheDocument();
    const ok = await screen.findByTestId("surv-pick-MAT-000101-MARA.MTART");
    expect(within(ok).getByText("Material type")).toBeInTheDocument();
    expect(within(ok).getByText("The source's value is not blank")).toBeInTheDocument();
    const bad = await screen.findByTestId("surv-pick-MAT-000102-MARA.MATKL");
    expect(within(bad).getByText("Not proved, the pick did not win")).toBeInTheDocument();
  });
});
