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
