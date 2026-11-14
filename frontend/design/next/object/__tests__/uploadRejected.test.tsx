import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { UploadStep } from "../cycle/UploadStep";
import type { ObjectRun } from "../useObjectRun";

vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/api/next/upload", () => ({ readCleanedRows: async () => ({}) }));
vi.mock("../cycle/uploadGate", async (orig) => ({
  ...(await orig<typeof import("../cycle/uploadGate")>()),
  checkCleaned: () => [{ id: "keys", status: "fail", count: 3 }],
  tally: () => ({ changed: 0, unchanged: 0, rejected: 3 }),
}));

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => window.sessionStorage.clear());

describe("upload rejected", () => {
  it("says which check failed, how to fix it, and keeps the upload off", async () => {
    renderWithQuery(<UploadStep o={{ heads: [] } as unknown as ObjectRun} onScored={() => undefined} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["x"], "cleaned.xlsx");
    fireEvent.change(input, { target: { files: [file] } });
    const box = await screen.findByTestId("upload-rejected");
    expect(box.textContent).toMatch(/Keys unchanged/);
    expect(box.textContent).toMatch(/Put back the key columns/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload and score" }).getAttribute("aria-disabled")).toBe("true"));
  });
});
