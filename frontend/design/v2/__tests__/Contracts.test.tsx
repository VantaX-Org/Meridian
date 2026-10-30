import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import runsJson from "@/lib/api/v2/fixtures/runs.json";
import * as s9 from "@/lib/api/v2/step9";
import { contractMark } from "@/lib/v2/step9";
import { resetKeptOutcomes } from "../inspector/shared";
import { Ruler } from "../Ruler";
import { ObjectContractsBlock } from "../screens/step9/Contracts";
import { RunCanvas } from "../screens/Run";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

const R8 = runsJson.versions[0].id;
let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  resetRunsFixture();
  resetKeptOutcomes();
  undo = stubLayout();
  h.allowed = "all";
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const dims = [62, 72, 70, 88, 90, 65];

describe("the contract breach mark", () => {
  it("is one mark with the words in its title, filled only when a breached contract is enforced", () => {
    expect(contractMark({ contract_breaches: 0 })).toBeNull();
    const weak = contractMark({ contract_breaches: 3, enforced_contract_breaches: 0 })!;
    const strong = contractMark({ contract_breaches: 3, enforced_contract_breaches: 3 })!;
    const { rerender } = renderWithQuery(<Ruler size={48} dims={dims} measured={71.8} score={70} capped capLevel={70} breaches={["MM142"]} label="Material master" records={1} rules={1} coverage={1} contract={weak} />);
    const mark = screen.getByTestId("contract-mark");
    expect(mark).toHaveAttribute("title", "3 data contract thresholds breached, not enforced");
    expect(mark).toHaveAttribute("data-enforced", "false");
    rerender(<Ruler size={240} dims={dims} measured={71.8} score={70} capped capLevel={70} breaches={["MM142"]} label="Material master" records={1} rules={1} coverage={1} contract={strong} />);
    expect(screen.getAllByTestId("contract-mark")).toHaveLength(1);
    expect(screen.getByTestId("contract-mark")).toHaveAttribute("data-enforced", "true");
    expect(screen.getByTestId("contract-mark")).toHaveAccessibleName(/3 enforced: a baseline cannot be pinned/);
  });
});

describe("the contract editor on the Object canvas", () => {
  it("lists the active contract, its breaches, and saves thresholds and enforcement", async () => {
    const spy = vi.spyOn(s9, "setEnforcement");
    renderWithQuery(<ObjectContractsBlock module="material_master" label="Material master" run={null} />);
    const block = await screen.findByTestId("object-contracts");
    await waitFor(() => expect(norm(block)).toContain("Data contracts: 1 active, 1 breached"));
    const one = within(block).getByTestId("object-contract");
    expect(norm(one)).toContain("Score 70.0, needs 85 or more");
    expect(norm(one)).toContain("Critical rules over tolerance 2, needs at most 0");
    expect(norm(one)).toContain("Completeness 62.0, needs 80 or more");
    expect(norm(one)).toContain("Reported only");
    fireEvent.change(within(one).getByLabelText("Validity, at least"), { target: { value: "70" } });
    fireEvent.click(within(one).getByRole("checkbox", { name: /Enforce/ }));
    fireEvent.click(within(one).getByRole("button", { name: "Save thresholds" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("ct-1", { enforce: true, thresholds: { min_score: 85, max_critical_breaches: 0, dimensions: { completeness: 80, validity: 70 } } }));
    await waitFor(() => expect(norm(screen.getByTestId("object-contracts"))).toContain("1 enforced"));
  });

  it("refuses a threshold that is not a number from 0 to 100", async () => {
    renderWithQuery(<ObjectContractsBlock module="material_master" label="Material master" run={null} />);
    const one = await screen.findByTestId("object-contract");
    fireEvent.change(within(one).getByLabelText("Minimum score"), { target: { value: "120" } });
    expect(within(one).getByRole("alert")).toHaveTextContent("Each threshold is a number from 0 to 100");
    expect(within(one).getByRole("button", { name: "Save thresholds" })).toBeDisabled();
  });

  it("reads only for a role without manage_rules", async () => {
    h.allowed = ["view"];
    renderWithQuery(<ObjectContractsBlock module="material_master" label="Material master" run={null} />);
    const one = await screen.findByTestId("object-contract");
    expect(within(one).queryByRole("button", { name: "Save thresholds" })).toBeNull();
    expect(within(one).getByLabelText("Minimum score")).toBeDisabled();
    expect(screen.queryByTestId("new-contract")).toBeNull();
  });
});

describe("pinning a run that breaches an enforced contract", () => {
  it("shows the backend's refusal and the breaches, and pins with a reason", async () => {
    await s9.setEnforcement("ct-1", { enforce: true, thresholds: { min_score: 85 } });
    setUrl(`/run/${R8}?fixture=1`);
    renderWithQuery(<RunCanvas id={R8} />);
    const pin = await screen.findByRole("button", { name: "Pin as baseline" });
    await waitFor(() => expect(pin).toBeEnabled());
    fireEvent.click(pin);
    const refusal = await screen.findByTestId("pin-refusal");
    expect(refusal).toHaveTextContent("This run breaches an enforced data contract; pin it with force and a reason.");
    expect(norm(refusal)).toContain("Material master to S/4HANA, Material master");
    expect(norm(refusal)).toContain("Score 70.0, needs 85 or more");
    fireEvent.change(within(refusal).getByLabelText("Why this run is pinned anyway"), { target: { value: "Mock 1 reference" } });
    fireEvent.click(within(refusal).getByRole("button", { name: "Pin anyway" }));
    expect(await screen.findByText("Pinned as the baseline, with the breach on record")).toBeInTheDocument();
    expect(screen.queryByTestId("pin-refusal")).toBeNull();
  });
});
