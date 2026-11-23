import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportDialog, ImportSheet, type ImportValidation } from "./ImportSheet";

const clean: ImportValidation = { ready: 12, warnings: 0, rejected: 0, problems: [] };
const mixed: ImportValidation = { ready: 10, warnings: 1, rejected: 2, problems: [{ row: "1001", column: "Name", value: "x", problem: "Too long", fix: "Shorten the value" }] };
const file = () => new File(["a"], "cleaned.xlsx");
const pick = (f: File) => fireEvent.change(document.querySelector("input[type=file]")!, { target: { files: [f] } });
const props = { accept: ".xlsx", fileLabel: "Cleaned file", hint: "Drop it", target: "PROD" };

describe("ImportSheet", () => {
  it("clean file: validates, reviews with the target, writes only after confirm", async () => {
    const apply = vi.fn().mockResolvedValue("Done it.");
    render(<ImportSheet {...props} validate={async () => clean} apply={apply} />);
    pick(file());
    fireEvent.click(await screen.findByRole("button", { name: "Continue to review" }));
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText("This will write to PROD.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply to PROD" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Done it.")).toBeTruthy();
  });
  it("rejected rows: lists the problems, states they are not written, offers the error report", async () => {
    render(<ImportSheet {...props} validate={async () => mixed} apply={vi.fn()} />);
    pick(file());
    expect(await screen.findByText("Too long")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download error report" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue to review" }));
    expect(screen.getByText("10 rows will be applied. 2 rows are rejected and will not be written.")).toBeTruthy();
  });
  it("wrong file: nothing ready blocks the review", async () => {
    render(<ImportSheet {...props} validate={async () => ({ ready: 0, warnings: 0, rejected: 0, problems: [{ column: "Template", problem: "Wrong template" }] })} apply={vi.fn()} />);
    pick(file());
    expect(await screen.findByText("Wrong template")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue to review" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("a failed check shows Retry and keeps the file", async () => {
    const validate = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(clean);
    render(<ImportSheet {...props} validate={validate} apply={vi.fn()} />);
    pick(file());
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Continue to review" })).toBeTruthy();
    expect(validate).toHaveBeenCalledTimes(2);
  });
  it("a failed apply keeps the review and says nothing changed", async () => {
    const apply = vi.fn().mockRejectedValue(new Error("boom"));
    render(<ImportSheet {...props} validate={async () => clean} apply={apply} />);
    pick(file());
    fireEvent.click(await screen.findByRole("button", { name: "Continue to review" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to PROD" }));
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
  });
  it("without a check endpoint it says so and still needs the confirm", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    render(<ImportSheet {...props} apply={apply} />);
    pick(file());
    expect(screen.getByText(/has no pre-check/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue to review" }));
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("ImportDialog", () => {
  it("asks before closing once a file is chosen", async () => {
    const onClose = vi.fn();
    render(<ImportDialog {...props} open onClose={onClose} label="Upload" closeLabel="Close" validate={async () => clean} apply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    pick(file());
    await screen.findByRole("button", { name: "Continue to review" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
