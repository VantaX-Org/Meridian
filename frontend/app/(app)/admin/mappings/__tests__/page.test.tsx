import { fireEvent, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as mappingsApi from "@/lib/api/field-mappings";
import type { FieldMapping } from "@/lib/api/field-mappings";
import AdminMappingsPage from "../page";

const role = vi.hoisted(() => ({ write: false }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => role.write }) }));

const MAPPING: FieldMapping = {
  id: "m1", module: "business_partner", standard_field: "LFA1.STCD1", standard_label: "Tax number",
  customer_field: "tax_no", customer_label: "Tax No", data_type: "string", is_mapped: true,
  notes: null, updated_at: "2026-01-01T00:00:00Z",
};

describe("admin field mappings page", () => {
  it("renders mappings once loaded", async () => {
    vi.spyOn(mappingsApi, "getFieldMappings").mockResolvedValue({ mappings: [MAPPING], total: 1, self_service_enabled: true });
    renderWithQuery(<AdminMappingsPage />);
    await waitFor(() => expect(screen.getByText("LFA1.STCD1")).toBeInTheDocument());
  });

  it("shows a retryable error when mappings fail to load", async () => {
    const spy = vi.spyOn(mappingsApi, "getFieldMappings").mockRejectedValue(new Error("network down"));
    renderWithQuery(<AdminMappingsPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue({ mappings: [MAPPING], total: 1, self_service_enabled: true });
    retry.click();
    await waitFor(() => expect(screen.getByText("LFA1.STCD1")).toBeInTheDocument());
  });

  it("keeps spaces while a column header is typed and trims it only on save", async () => {
    role.write = true;
    try {
      vi.spyOn(mappingsApi, "getFieldMappings").mockResolvedValue({ mappings: [{ ...MAPPING, customer_field: null, is_mapped: false }], total: 1, self_service_enabled: true });
      const update = vi.spyOn(mappingsApi, "updateFieldMapping").mockResolvedValue({ ...MAPPING, customer_field: "Material Number" });
      renderWithQuery(<AdminMappingsPage />);
      const input = await screen.findByLabelText("LFA1.STCD1 customer column");
      fireEvent.change(input, { target: { value: "Material " } });
      expect(input).toHaveValue("Material ");
      fireEvent.change(input, { target: { value: " Material Number " } });
      expect(input).toHaveValue(" Material Number ");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(update).toHaveBeenCalled());
      expect(update.mock.calls[0][1]).toMatchObject({ customer_field: "Material Number", is_mapped: true });
    } finally {
      role.write = false;
    }
  });
});
