// frontend/design/primitives/ExportMenu.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";

let permissions: string[] = ["export"];

vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", email: "a@b.com", name: "A", role: "analyst", permissions } }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ExportMenu, ReportPrintContext, emptyExportOptions } from "./ExportMenu";

describe("ExportMenu", () => {
  beforeEach(() => {
    permissions = ["export"];
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("returns null for a viewer without export permission", () => {
    permissions = [];
    const { container } = render(<ExportMenu options={[{ format: "xlsx", run: vi.fn() }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a single-option button content-width, like the menu trigger", () => {
    render(<ExportMenu options={[{ format: "xlsx", run: vi.fn() }]} />);
    expect(screen.getByRole("button", { name: "Export" })).toHaveClass("self-start");
  });

  it("renders a plain Export button for one option and toasts on resolve", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    render(<ExportMenu options={[{ format: "xlsx", run }]} />);
    const button = screen.getByRole("button", { name: "Export" });
    fireEvent.click(button);
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Download started"));
  });

  it("renders a menu with labelled items for multiple options", () => {
    render(
      <ExportMenu
        options={[
          { format: "xlsx", run: vi.fn() },
          { format: "pdf", run: vi.fn() },
        ]}
      />,
    );
    expect(screen.getAllByRole("button", { name: /Export/ }).length).toBeGreaterThan(0);
  });

  it("toasts the error detail on reject", async () => {
    const run = vi.fn().mockRejectedValue(new Error("export limit exceeded"));
    render(<ExportMenu options={[{ format: "xlsx", run }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("export limit exceeded"));
  });

  it("emptyExportOptions resolves with 'Nothing to export' without calling the API", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const options = emptyExportOptions([{ format: "xlsx", run }]);
    render(<ExportMenu options={options} />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nothing to export"));
    expect(run).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  describe("on a report page", () => {
    const inReport = (ui: React.ReactElement) => render(<ReportPrintContext.Provider value>{ui}</ReportPrintContext.Provider>);

    it("adds a Print item that calls window.print", async () => {
      const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
      inReport(<ExportMenu options={[{ format: "xlsx", run: vi.fn() }]} />);
      fireEvent.click(screen.getByRole("button", { name: /Export/ }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Print" }));
      expect(print).toHaveBeenCalledOnce();
      print.mockRestore();
    });

    it("keeps Print for a viewer who cannot export", () => {
      permissions = [];
      const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
      inReport(<ExportMenu options={[{ format: "xlsx", run: vi.fn() }]} />);
      expect(screen.queryByRole("button", { name: /Export/ })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Print" }));
      expect(print).toHaveBeenCalledOnce();
      print.mockRestore();
    });

    it("outside a report page there is no Print", () => {
      render(<ExportMenu options={[{ format: "xlsx", run: vi.fn() }, { format: "pdf", run: vi.fn() }]} />);
      expect(screen.queryByText("Print")).not.toBeInTheDocument();
    });
  });
});
