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

  it("sends the object when one is named", async () => {
    const { uploadCleaned } = await import("./roundtrip");
    await uploadCleaned(new File(["x"], "fixed.xlsx"), undefined, "material_master");
    expect((post.mock.calls[0] as unknown as [string, FormData])[1].get("module")).toBe("material_master");
  });

  it("reads the fix and the rejected rows of a structured error", async () => {
    const { uploadFix, uploadRows } = await import("./roundtrip");
    const row = { sheet: "Records to clean", row: 7, table: "MARA", key: "MATNR=1", field: "MTART", reason: "No record." };
    const err = { response: { data: { detail: { error: "nothing_applied", detail: "No edit matched.", fix: "Download the rejected rows.", unmatched_rows: [row] } } } };
    expect(uploadFix(err)).toBe("Download the rejected rows.");
    expect(uploadRows(err)).toEqual([row]);
    expect(uploadFix({ response: { data: { detail: "plain" } } })).toBeUndefined();
    expect(uploadRows(null)).toEqual([]);
  });

  it("writes the rejected rows as CSV with row numbers, quoting commas", async () => {
    const { rejectedCsv } = await import("./roundtrip");
    const csv = rejectedCsv([
      { sheet: "Records to clean", row: 7, table: "MARA", key: "MATNR=1", field: "MTART", reason: "No record, key changed." },
      { sheet: "", row: 0, table: "MARC", key: "MATNR=2|WERKS=1", field: "", reason: "No table." },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Sheet,Row,Table,Record key,Field,Reason");
    expect(lines[1]).toBe('Records to clean,7,MARA,MATNR=1,MTART,"No record, key changed."');
    expect(lines[2].startsWith(",,MARC,")).toBe(true);
  });
});
