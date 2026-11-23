import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportMenu } from "./ExportMenu";
import { ToastHost } from "./Toast";

const formats = [{ id: "xlsx", label: "Excel workbook" }, { id: "csv", label: "CSV" }];
const open = () => fireEvent.click(screen.getByRole("button", { name: /Export/ }));

describe("ExportMenu", () => {
  it("calls onExport with the picked format and toasts the saved file name", async () => {
    const onExport = vi.fn().mockResolvedValue("a.csv");
    render(<ToastHost><ExportMenu formats={formats} onExport={onExport} /></ToastHost>);
    open();
    fireEvent.click(screen.getByLabelText("CSV"));
    fireEvent.click(screen.getAllByRole("button", { name: "Export" }).pop()!);
    await waitFor(() => expect(onExport).toHaveBeenCalledWith("csv"));
    expect(await screen.findByText("Saved a.csv.")).toBeTruthy();
  });
  it("shows the row count on the button", () => {
    render(<ToastHost><ExportMenu formats={formats} onExport={vi.fn()} count={42} /></ToastHost>);
    open();
    expect(screen.getByRole("button", { name: "Export 42 rows" })).toBeTruthy();
  });
  it("states personal data", () => {
    render(<ToastHost><ExportMenu formats={formats} onExport={vi.fn()} personalData /></ToastHost>);
    open();
    expect(screen.getByText(/holds personal data/)).toBeTruthy();
  });
  it("shows the failure with Retry and recovers", async () => {
    const onExport = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue("b.xlsx");
    render(<ToastHost><ExportMenu formats={formats} onExport={onExport} /></ToastHost>);
    open();
    fireEvent.click(screen.getAllByRole("button", { name: "Export" }).pop()!);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(2));
  });
});
