import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "../../../__tests__/render";
import * as exceptionsApi from "@/lib/api/exceptions";
import type { WorkRecordDetail } from "@/lib/api/work";
import { RaiseException, exceptionBody, worstSeverity } from "../raise-exception";

let allowed = true;
vi.mock("@/lib/permissions", () => ({ usePermissions: () => ({ can: (a: string) => allowed && a === "analyse" }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

afterEach(() => { vi.restoreAllMocks(); allowed = true; });

const issue = (check_id: string, severity: "critical" | "high" | "medium" | "low" | "info") => ({ check_id, severity }) as WorkRecordDetail["issues"][number];
const rec = { module: "material_master", record_key: "MATNR=2", issues: [issue("MM002", "medium"), issue("MM001", "high")] } as WorkRecordDetail;

describe("raise an exception", () => {
  it("starts at the worst severity of the failing checks, never above low for info", () => {
    expect(worstSeverity(rec.issues)).toBe("high");
    expect(worstSeverity([issue("X", "info")])).toBe("low");
  });

  it("describes the record with the reason as the description", () => {
    expect(exceptionBody(rec, " Vendor will correct in SAP ", "high")).toEqual({
      type: "dq_rule", category: "data_quality", severity: "high",
      title: "Material master record MATNR=2: 2 failing checks", description: "Vendor will correct in SAP",
      affected_records: { module: "material_master", record_key: "MATNR=2", check_ids: ["MM002", "MM001"] }, object_type: "material_master",
    });
  });

  it("posts the form and closes", async () => {
    const create = vi.spyOn(exceptionsApi, "createException").mockResolvedValue({ id: "e1", status: "open" });
    renderWithQuery(<RaiseException rec={rec} />);
    fireEvent.click(screen.getByRole("button", { name: "Raise an exception" }));
    const submit = await screen.findByRole("button", { name: "Raise exception" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: "Waiting on the vendor" } });
    fireEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ severity: "high", description: "Waiting on the vendor" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the form open and says why when the API refuses", async () => {
    const { toast } = await import("sonner");
    vi.spyOn(exceptionsApi, "createException").mockRejectedValue(new Error("nope"));
    renderWithQuery(<RaiseException rec={rec} />);
    fireEvent.click(screen.getByRole("button", { name: "Raise an exception" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Reason" }), { target: { value: "r" } });
    fireEvent.click(screen.getByRole("button", { name: "Raise exception" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("is not offered without analyse or process discovery", () => {
    allowed = false;
    renderWithQuery(<RaiseException rec={rec} />);
    expect(screen.queryByRole("button", { name: "Raise an exception" })).toBeNull();
  });
});
