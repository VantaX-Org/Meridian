import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as usersApi from "@/lib/api/users";
import { ImportUsersDrawer } from "../import-users-drawer";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts, Toaster: () => null }));

const CSV = "email,name,role,system,module\nana@example.com,Ana,data_steward,,\nnot-an-email,Bad,,,\nben@example.com,Ben,viewer,ECC prod,fi_gl";

const PREVIEW: usersApi.ImportPreview = {
  rows: [
    { line: 2, email: "ana@example.com", name: "Ana", role: "data_steward", system_id: null, system_name: null, module: null, ok: true, error: null },
    { line: 3, email: "not-an-email", name: "Bad", role: "", system_id: null, system_name: null, module: null, ok: false, error: "Enter a valid email address" },
    { line: 4, email: "ben@example.com", name: "Ben", role: "viewer", system_id: "s1", system_name: "ECC prod", module: "fi_gl", ok: true, error: null },
  ],
  accepted: 2, rejected: 1, seats: { used: 41, limit: 50, needed: 2, available: 9, ok: true },
};

beforeEach(() => {
  vi.restoreAllMocks();
  toasts.success.mockReset();
  toasts.error.mockReset();
});

const typeCsv = () => fireEvent.change(screen.getByLabelText("CSV"), { target: { value: CSV } });

describe("ImportUsersDrawer", () => {
  it("previews every line with its own verdict and the seat summary", async () => {
    const preview = vi.spyOn(usersApi, "previewUserImport").mockResolvedValue(PREVIEW);
    renderWithQuery(<ImportUsersDrawer open onOpenChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    typeCsv();
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith(CSV));
    const table = await screen.findByRole("table", { name: "Import preview" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Ready")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Skipped")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Enter a valid email address")).toBeInTheDocument();
    expect(within(rows[2]).getByText("ECC prod, FI general ledger")).toBeInTheDocument();
    expect(screen.getByTestId("import-summary")).toHaveTextContent("2 ready, 1 with a problem");
    expect(screen.getByTestId("import-seats")).toHaveTextContent("2 people will take seats. 41 of 50 are in use, 9 free.");
  });

  it("imports what passed and reports the lines it skipped", async () => {
    vi.spyOn(usersApi, "previewUserImport").mockResolvedValue(PREVIEW);
    const run = vi.spyOn(usersApi, "importUsers").mockResolvedValue({
      created: [{ line: 2, id: "u1", email: "ana@example.com" }],
      skipped: [{ line: 3, email: "not-an-email", error: "Enter a valid email address" }, { line: 4, email: "ben@example.com", error: "A user with this email already exists" }],
    });
    renderWithQuery(<ImportUsersDrawer open onOpenChange={() => {}} />);
    typeCsv();
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import 2 people" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith(CSV));
    expect(await screen.findByText("1 person invited")).toBeInTheDocument();
    expect(screen.getByText(/Line 4, ben@example.com: A user with this email already exists/)).toBeInTheDocument();
    expect(toasts.success).toHaveBeenCalledWith("1 person invited, 2 skipped");
  });

  it("refuses at the seat limit with the API sentence and keeps Import off", async () => {
    vi.spyOn(usersApi, "previewUserImport").mockResolvedValue({ ...PREVIEW, seats: { used: 49, limit: 50, needed: 2, available: 1, ok: false } });
    const run = vi.spyOn(usersApi, "importUsers");
    renderWithQuery(<ImportUsersDrawer open onOpenChange={() => {}} />);
    typeCsv();
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    expect(await screen.findByText("Licence seats are full (49 of 50). Suspend a user or raise the licence.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 2 people" })).toBeDisabled();
    expect(run).not.toHaveBeenCalled();
  });

  it("shows the API's own refusal when the commit is turned down", async () => {
    vi.spyOn(usersApi, "previewUserImport").mockResolvedValue(PREVIEW);
    vi.spyOn(usersApi, "importUsers").mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { detail: "Licence seats are full (50 of 50). Suspend a user or raise the licence." } } });
    renderWithQuery(<ImportUsersDrawer open onOpenChange={() => {}} />);
    typeCsv();
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import 2 people" }));
    expect(await screen.findByText("Licence seats are full (50 of 50). Suspend a user or raise the licence.")).toBeInTheDocument();
  });

  it("reads an uploaded file into the box and drops the old preview", async () => {
    vi.spyOn(usersApi, "previewUserImport").mockResolvedValue(PREVIEW);
    renderWithQuery(<ImportUsersDrawer open onOpenChange={() => {}} />);
    typeCsv();
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    await screen.findByRole("table", { name: "Import preview" });
    const file = new File(["email\nzed@example.com"], "people.csv", { type: "text/csv" });
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText("CSV")).toHaveValue("email\nzed@example.com"));
    expect(screen.queryByRole("table", { name: "Import preview" })).toBeNull();
  });
});
