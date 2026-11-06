import { afterEach, describe, expect, it, vi } from "vitest";

const post = vi.fn(async () => ({ data: new Blob(["x"]), headers: { "content-disposition": 'attachment; filename="out.xlsx"' } }));
vi.mock("@/lib/api/client", () => ({ uploadApiClient: { post, get: vi.fn() } }));
vi.mock("./fixture", () => ({ fixtureActive: () => false }));

afterEach(() => post.mockClear());

describe("v2Download", () => {
  it("posts a form body as multipart and saves under the server's file name", async () => {
    window.URL.createObjectURL = vi.fn(() => "blob:x");
    window.URL.revokeObjectURL = vi.fn();
    const { v2Download } = await import("./download");
    const body = new FormData();
    expect(await v2Download("/x", { format: "xlsx" }, "fallback.xlsx", "post", body)).toBe("out.xlsx");
    const [url, sent, config] = post.mock.calls[0] as unknown as [string, FormData, { headers: Record<string, string>; params: unknown }];
    expect([url, sent, config.params]).toEqual(["/api/v1/x", body, { format: "xlsx" }]);
    expect(config.headers["Content-Type"]).toBe("multipart/form-data");
  });
});
