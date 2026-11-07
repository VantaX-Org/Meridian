import { afterEach, describe, expect, it, vi } from "vitest";

const download = vi.fn(async () => "saved");
vi.mock("./download", () => ({ v2Download: download }));
vi.mock("./client", () => ({ v2Get: vi.fn(), v2Send: vi.fn() }));

describe("exportLoadFiles", () => {
  afterEach(() => download.mockClear());

  it("asks for the run's load files and names a csv export a zip", async () => {
    const { exportLoadFiles } = await import("./migration");
    await exportLoadFiles("run 1", "csv");
    expect(download).toHaveBeenCalledWith("/migration/export/run%201/csv", undefined, "migration_run 1.zip");
  });

  it("names an Excel export xlsx", async () => {
    const { exportLoadFiles } = await import("./migration");
    await exportLoadFiles("r2", "xlsx");
    expect(download).toHaveBeenCalledWith("/migration/export/r2/xlsx", undefined, "migration_r2.xlsx");
  });
});

describe("exportTargetWorkbook", () => {
  afterEach(() => download.mockClear());

  it("posts the workbook as a form and names a csv export a zip", async () => {
    const { exportTargetWorkbook } = await import("./migration");
    const file = new File(["x"], "target.xlsx");
    await exportTargetWorkbook("r 1", file, "csv");
    const [path, params, name, method, body] = download.mock.calls[0] as unknown as [string, unknown, string, string, FormData];
    expect([path, params, name, method]).toEqual(["/migration/target-workbook/r%201/export", { format: "csv" }, "target_workbook_r 1.zip", "post"]);
    expect((body.get("file") as File).name).toBe("target.xlsx");
  });

  it("names a same-format export by the extension the check reported", async () => {
    const { exportTargetWorkbook } = await import("./migration");
    await exportTargetWorkbook("r1", new File(["x"], "target.xml"), "source", "xml");
    expect((download.mock.calls.at(-1) as unknown as unknown[]).slice(1, 3)).toEqual([{ format: "source" }, "target_workbook_r1.xml"]);
  });
});
