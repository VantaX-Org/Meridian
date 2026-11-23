import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadApiClient } from "../client";
import { bytesToBase64, downloadBlob } from "../download";

afterEach(() => vi.restoreAllMocks());

function spyDom() {
  const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() } as unknown as HTMLAnchorElement;
  vi.spyOn(document, "createElement").mockReturnValue(link);
  vi.spyOn(document.body, "appendChild").mockReturnValue(link);
  window.URL.createObjectURL = vi.fn(() => "blob:x");
  window.URL.revokeObjectURL = vi.fn();
  return link;
}

describe("downloadBlob", () => {
  it("asks for a blob with the params, then saves it under the server file name", async () => {
    const link = spyDom();
    const get = vi.spyOn(uploadApiClient, "get").mockResolvedValue({
      data: new Blob(["x"]), headers: { "content-disposition": "attachment; filename*=UTF-8''Caf%C3%A9.xlsx" },
    });
    await downloadBlob("/api/v1/exports/findings", { format: "xlsx" }, "fallback.xlsx");
    expect(get).toHaveBeenCalledWith("/api/v1/exports/findings", { responseType: "blob", params: { format: "xlsx" } });
    expect(link.download).toBe("Café.xlsx");
    expect(link.click).toHaveBeenCalled();
  });

  it("falls back to the given name when the server sends none", async () => {
    const link = spyDom();
    vi.spyOn(uploadApiClient, "get").mockResolvedValue({ data: new Blob(["x"]), headers: {} });
    await downloadBlob("/u", {}, "fallback.csv");
    expect(link.download).toBe("fallback.csv");
  });

  it("surfaces the JSON detail of a refused export as the error message", async () => {
    spyDom();
    const body = new Blob([JSON.stringify({ detail: "Gate not passed" })]);
    vi.spyOn(uploadApiClient, "get").mockRejectedValue({ response: { data: body } });
    await expect(downloadBlob("/u", {}, "f.xlsx")).rejects.toThrow("Gate not passed");
  });
});

describe("bytesToBase64", () => {
  it("encodes a workbook-sized file without overflowing the stack", () => {
    const big = new Uint8Array(500_000).fill(65);
    expect(atob(bytesToBase64(big))).toBe("A".repeat(500_000));
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=");
  });
});
