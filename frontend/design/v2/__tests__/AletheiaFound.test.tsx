import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as insights from "@/lib/api/v2/insights";
import * as mdm from "@/lib/api/v2/mdm";
import { AletheiaFound } from "../screens/AletheiaFound";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Aletheia found", () => {
  it("ranks findings with their rule text, field, driver, money, confidence and one action", async () => {
    renderWithQuery(<AletheiaFound />);
    const rows = await screen.findAllByTestId("aletheia-finding");
    expect(rows).toHaveLength(6);
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

  it("sends a duplicate rule with review pairs to the object's match and merge review and records it", async () => {
    const acted = vi.spyOn(insights, "markActed");
    renderWithQuery(<AletheiaFound />);
    const rows = await screen.findAllByTestId("aletheia-finding");
    const mm168 = rows.find((r) => r.textContent?.includes("MM168")) as HTMLElement;
    expect(mm168).toHaveTextContent("Pairs waiting for review: 14");
    const link = within(mm168).getByRole("link", { name: "Review duplicates" });
    await waitFor(() => expect(link.getAttribute("href")).toMatch(/^\/o\/[^/]+\/[^/]+\/golden/));
    fireEvent.click(link);
    expect(acted).toHaveBeenCalledWith({ module: "material_master", check_id: "MM168", action: "merge" });
  });

  it("assigns an owner to a rule nobody owns and records the action", async () => {
    const owner = vi.spyOn(mdm, "putOwner");
    const acted = vi.spyOn(insights, "markActed");
    renderWithQuery(<AletheiaFound />);
    const rows = await screen.findAllByTestId("aletheia-finding");
    const sdcm = rows.find((r) => r.textContent?.includes("SDCM001")) as HTMLElement;
    const button = within(sdcm).getByRole("button", { name: "Assign owner" });
    expect(button).toBeDisabled();
    const select = within(sdcm).getByRole("combobox", { name: "Owner of SDCM001" });
    await waitFor(() => expect(select.querySelectorAll("option").length).toBeGreaterThan(1));
    const person = (select.querySelectorAll("option")[1] as HTMLOptionElement).value;
    fireEvent.change(select, { target: { value: person } });
    fireEvent.click(button);
    await waitFor(() => expect(within(sdcm).getByRole("status")).toHaveTextContent("Owner assigned"));
    expect(owner).toHaveBeenCalledWith("rule", "SDCM001", person);
    expect(acted).toHaveBeenCalledWith({ module: "sd_customer_master", check_id: "SDCM001", action: "assign" });
  });

  it("stays out of the way for an object with nothing found", async () => {
    const { container } = renderWithQuery(<AletheiaFound module="fi_gl" />);
    await waitFor(() => expect(container.querySelector("[data-testid=aletheia-found]")).toBeNull());
  });
});
