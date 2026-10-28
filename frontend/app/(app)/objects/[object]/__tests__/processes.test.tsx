import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivity from "@/lib/api/connectivity";
import type { BusinessProcessL1, BusinessProcessL5Field } from "@/types/api";
import { ObjectProcesses, processesOf } from "../_processes";

const field = (over: Partial<BusinessProcessL5Field>): BusinessProcessL5Field => ({
  field: "LIFNR", description: "Vendor", mandatory: true, dq_status: "green", pass_rate: 100, affected_count: 0, check_id: null,
  finding_message: "", ...over,
}) as BusinessProcessL5Field;

const l1 = (id: string, name: string, steps: Record<string, BusinessProcessL5Field[]>): BusinessProcessL1 => ({
  l1_id: id, l1_name: name, l1_description: "", system: "ecc",
  l2_groups: [{ l2_id: "l2", l2_name: "L2", l3_processes: Object.entries(steps).map(([step, fields]) => ({
    l3_id: step, l3_name: step, description: "", overall_readiness: "green",
    l4_subprocesses: [{ activities: [{ fields }] }],
  })) }],
}) as unknown as BusinessProcessL1;

const RED = field({ dq_status: "red", check_id: "AP016", affected_count: 12 });

beforeEach(() => vi.restoreAllMocks());

describe("processesOf", () => {
  it("names the L1s whose fields come from the object, and none for any other", () => {
    expect(processesOf("fi_gl")).toEqual(["PTP", "OTC"]);
    expect(processesOf("material_master")).toEqual(["PTP"]);
    expect(processesOf("business_partner")).toEqual([]);
  });
});

describe("ObjectProcesses", () => {
  it("shows a tile per process the object feeds with its verdict and blocked steps, opening the readiness page", async () => {
    vi.spyOn(connectivity, "getBusinessProcess").mockResolvedValue([
      l1("PTP", "Procure to pay", { Onboarding: [RED], Payment: [RED], Receipt: [field({})] }),
      l1("OTC", "Order to cash", { Billing: [field({})] }),
    ]);
    renderWithQuery(<ObjectProcesses object="fi_gl" run="v1" />);
    const ptp = (await screen.findByText("Procure to pay")).closest("a") as HTMLElement;
    expect(ptp).toHaveTextContent("No-go");
    expect(ptp).toHaveTextContent("2 steps blocked");
    expect(ptp).toHaveAttribute("href", "/insights/process?l1=PTP&object=fi_gl&run=v1");
    const otc = screen.getByText("Order to cash").closest("a") as HTMLElement;
    expect(otc).toHaveTextContent("Go");
    expect(otc).toHaveTextContent("No steps blocked");
    expect(connectivity.getBusinessProcess).toHaveBeenCalledWith("v1", "fi_gl");
  });

  it("is hidden for an object that feeds no process, without reading anything", () => {
    const read = vi.spyOn(connectivity, "getBusinessProcess");
    const { container } = renderWithQuery(<ObjectProcesses object="business_partner" run="v1" />);
    expect(container).toBeEmptyDOMElement();
    expect(read).not.toHaveBeenCalled();
  });

  it("is hidden when the run holds no process document for the object", async () => {
    vi.spyOn(connectivity, "getBusinessProcess").mockResolvedValue([]);
    const { container } = renderWithQuery(<ObjectProcesses object="material_master" run="v1" />);
    await vi.waitFor(() => expect(container.querySelector("[aria-busy]")).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });
});
