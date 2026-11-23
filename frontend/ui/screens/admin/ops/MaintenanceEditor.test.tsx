import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { ToastHost } from "@/ui/kit";
import { getMaintenance } from "@/lib/api/v2/maintenance";
import { resetMaintenanceFixture } from "@/lib/api/v2/fixtures/maintenance";
import { MaintenanceEditor } from "./MaintenanceEditor";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.history.replaceState(null, "", "/admin?fixture=1"); resetMaintenanceFixture(); });
afterEach(() => undo());

/** The real screen feeds the editor from the status page; here the list comes straight from the maintenance read. */
function Host() {
  const q = useQuery({ queryKey: ["v2", "admin", true, "status", "page"], queryFn: getMaintenance });
  return q.data ? <MaintenanceEditor windows={q.data.windows} /> : null;
}

describe("maintenance editor", () => {
  it("lists a window, adds one and removes it", async () => {
    renderWithQuery(<ToastHost><Host /></ToastHost>);
    expect(await screen.findByText("Database upgrade")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Network change" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2030-01-01T10:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2030-01-01T11:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Add maintenance window" }));
    expect(await screen.findByText("Network change")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    await waitFor(() => expect(screen.queryByText("Database upgrade")).toBeNull());
  });
});
