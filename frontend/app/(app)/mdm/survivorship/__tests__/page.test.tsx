import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { toast } from "@/design";
import * as api from "@/lib/api/survivorship";
import type { SurvivorshipRule } from "@/lib/api/survivorship";
import SurvivorshipPage from "../page";

let perms = new Set<string>();
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => perms.has(a), loading: false }) }));

const NAME: SurvivorshipRule = { id: "s1", domain: "business_partner", field: "NAME_ORG1", rule_type: "trusted_source", trusted_sources: ["ECC"], weight: 1, active: true, ai_inferred: false };
const CITY: SurvivorshipRule = { id: "s2", domain: "business_partner", field: "CITY1", rule_type: "most_recent", trusted_sources: null, weight: 50, active: false, ai_inferred: true };
const MATL: SurvivorshipRule = { id: "s3", domain: "material_master", field: "MAKTX", rule_type: "most_complete", trusted_sources: null, weight: 50, active: true, ai_inferred: false };

describe("survivorship rules page", () => {
  beforeEach(() => {
    perms = new Set();
  });

  it("says which value each field keeps in plain words", async () => {
    vi.spyOn(api, "getSurvivorshipRules").mockResolvedValue({ rules: [NAME], total: 1 });
    renderWithQuery(<SurvivorshipPage />);
    expect(await screen.findByText("Trusted system wins")).toBeInTheDocument();
    expect(screen.getByText("NAME_ORG1")).toBeInTheDocument();
    expect(screen.getByText(/decide which value each field keeps/)).toBeInTheDocument();
  });

  it("explains the default when there are no rules and points to match review", async () => {
    vi.spyOn(api, "getSurvivorshipRules").mockResolvedValue({ rules: [], total: 0 });
    renderWithQuery(<SurvivorshipPage />);
    expect(await screen.findByText("No survivorship rules")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Review match pairs" })[0]).toHaveAttribute("href", "/mdm/golden/merge");
  });

  it("stays read-only for a user who may not edit master data, and says who can", async () => {
    perms = new Set(["mdm.read"]);
    vi.spyOn(api, "getSurvivorshipRules").mockResolvedValue({ rules: [NAME], total: 1 });
    renderWithQuery(<SurvivorshipPage />);
    expect(await screen.findByText("Only master data editors can change survivorship rules")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("saves an edited domain's whole rule set after a confirm that says when golden records change", async () => {
    perms = new Set(["mdm.write"]);
    vi.spyOn(api, "getSurvivorshipRules").mockResolvedValue({ rules: [NAME, CITY, MATL], total: 3 });
    const put = vi.spyOn(api, "putSurvivorshipRules").mockResolvedValue({ rules: [], total: 0 });
    renderWithQuery(<SurvivorshipPage />);
    const user = userEvent.setup();

    const sources = await screen.findByRole("textbox", { name: "Trusted systems for NAME_ORG1" });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user.clear(sources);
    await user.type(sources, "S4H, ECC");
    await user.click(screen.getByRole("combobox", { name: "Which value CITY1 keeps" }));
    await user.click(await screen.findByRole("option", { name: "Most common value wins" }));

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/pick up the new rules when the next analysis run or merge rebuilds them/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith("business_partner", [
      { field: "NAME_ORG1", rule_type: "trusted_source", trusted_sources: ["S4H", "ECC"], weight: 1, active: true },
      { field: "CITY1", rule_type: "most_frequent", trusted_sources: null, weight: 50, active: false },
    ]);
  });

  it("shows an error toast when the save fails", async () => {
    perms = new Set(["mdm.write"]);
    vi.spyOn(api, "getSurvivorshipRules").mockResolvedValue({ rules: [NAME], total: 1 });
    vi.spyOn(api, "putSurvivorshipRules").mockRejectedValue(new Error("network down"));
    const error = vi.spyOn(toast, "error");
    renderWithQuery(<SurvivorshipPage />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "Trusted systems for NAME_ORG1" }), ", S4H");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("Could not save the survivorship rules", expect.anything()));
  });
});
