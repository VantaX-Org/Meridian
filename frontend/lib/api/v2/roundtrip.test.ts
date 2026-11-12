import { afterEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed rest args let tests read mock.calls
const post = vi.fn(async (..._a: unknown[]) => ({ data: { version_id: "new" } }));
vi.mock("@/lib/api/client", () => ({ uploadApiClient: { post, get: vi.fn() } }));
vi.mock("./fixture", () => ({ fixtureActive: () => false }));

afterEach(() => post.mockClear());

describe("uploadCleaned", () => {
  it("posts the file and the chosen parent as multipart", async () => {
    const { uploadCleaned } = await import("./roundtrip");
    await uploadCleaned(new File(["x"], "fixed.xlsx"), "parent-1");
    const [url, form] = post.mock.calls[0] as unknown as [string, FormData];
    expect(url).toBe("/api/v1/upload/roundtrip");
    expect([(form.get("file") as File).name, form.get("parent_version_id")]).toEqual(["fixed.xlsx", "parent-1"]);
  });

  it("sends no parent field when the file carries a marker", async () => {
    const { uploadCleaned } = await import("./roundtrip");
    await uploadCleaned(new File(["x"], "fixed.csv"));
    expect((post.mock.calls[0] as unknown as [string, FormData])[1].has("parent_version_id")).toBe(false);
  });

  it("reads the parent_required error and the API sentence", async () => {
    const { needsParent, uploadSentence } = await import("./roundtrip");
    const err = (detail: unknown) => ({ response: { data: { detail } } });
    expect(needsParent(err({ error: "parent_required" }))).toBe(true);
    expect(needsParent(err("The file is larger than 25 MB."))).toBe(false);
    expect(uploadSentence(err("The file is larger than 25 MB."), "x")).toBe("The file is larger than 25 MB.");
    expect(uploadSentence(err({ error: "module_mismatch", detail: "Wrong object." }), "x")).toBe("Wrong object.");
    expect(uploadSentence(null, "fallback")).toBe("fallback");
  });
});
