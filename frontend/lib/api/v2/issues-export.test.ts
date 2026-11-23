import { afterEach, describe, expect, it, vi } from "vitest";

const download = vi.fn(async () => "saved");
vi.mock("./download", () => ({ v2Download: download }));
vi.mock("./client", () => ({ v2Get: vi.fn(), v2Send: vi.fn() }));

describe("exportIssues", () => {
  afterEach(() => download.mockClear());

  it("asks for the format the steward picked and names the file by it", async () => {
    const { exportIssues } = await import("./issues");
    await exportIssues({ status: "open" }, "csv");
    expect(download).toHaveBeenCalledWith("/issues/export", { format: "csv", status: "open" }, "issues.csv");
  });

  it("defaults to xlsx", async () => {
    const { exportIssues } = await import("./issues");
    await exportIssues({});
    expect(download).toHaveBeenCalledWith("/issues/export", { format: "xlsx" }, "issues.xlsx");
  });
});
