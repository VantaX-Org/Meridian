import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as insights from "@/lib/api/v2/insights";
import { AletheiaFound } from "../screens/AletheiaFound";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Aletheia found", () => {
  it("ranks findings with their rule text, field, driver, money, confidence and one action", async () => {
    renderWithQuery(<AletheiaFound />);
    const rows = await screen.findAllByTestId("aletheia-finding");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("MM003");
    expect(rows[0]).toHaveTextContent("Material type is mandatory");
    expect(rows[0]).toHaveTextContent("MARA-MTART");
    expect(rows[0]).toHaveTextContent("71.0% of the failing values come from one origin");
    // The origin itself is never named in the band.
    expect(rows[0].textContent).not.toMatch(/ZMM_MASS_UPLOAD/);
    expect(within(rows[0]).getByRole("button", { name: "Draft cleansing batch" })).toBeInTheDocument();
    const mm228 = rows.find((r) => r.textContent?.includes("MM228"));
    expect(mm228).toBeDefined();
    expect(within(mm228 as HTMLElement).getByRole("button", { name: "Draft tuned version" })).toBeInTheDocument();
    const mm035 = rows.find((r) => r.textContent?.includes("MM035")) as HTMLElement;
    expect(within(mm035).getByRole("link", { name: "Open rule" }).getAttribute("href")).toMatch(/^\/r\/MM035/);
    expect(within(mm035).getByText("—")).toBeInTheDocument();
  });

  it("shows what changed since the last run and the proof of value of acted findings", async () => {
    renderWithQuery(<AletheiaFound module="material_master" />);
    const changed = await screen.findByTestId("aletheia-changed");
    expect(changed).toHaveTextContent("+1.2");
    expect(changed).toHaveTextContent("MM003");
    const proof = screen.getAllByTestId("aletheia-proof-row");
    const mm142 = proof.find((p) => p.textContent?.includes("MM142")) as HTMLElement;
    expect(mm142).toHaveTextContent("Base unit of measure MEINS");
    expect(mm142).toHaveTextContent("175 fewer failing records");
    expect(mm142).toHaveTextContent("Duplicate vendor payments");
  });

  it("drafts a cleansing batch for the rule and records the action as waiting for the next run", async () => {
    const batch = vi.spyOn(insights, "createRuleBatch");
    const acted = vi.spyOn(insights, "markActed");
    renderWithQuery(<AletheiaFound />);
    const rows = await screen.findAllByTestId("aletheia-finding");
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Draft cleansing batch" }));
    await waitFor(() => expect(within(rows[0]).getByRole("status")).toHaveTextContent("Cleansing batch drafted"));
    expect(batch).toHaveBeenCalledWith(expect.stringContaining("MM003"), { module: "material_master", check_id: "MM003" });
    expect(acted).toHaveBeenCalledWith({ module: "material_master", check_id: "MM003", action: "cleanse" });
    await waitFor(() => expect(screen.getByTestId("aletheia-proof")).toHaveTextContent("Waiting for the next run"));
  });

  it("stays out of the way for an object with nothing found", async () => {
    const { container } = renderWithQuery(<AletheiaFound module="fi_gl" />);
    await waitFor(() => expect(container.querySelector("[data-testid=aletheia-found]")).toBeNull());
  });
});
