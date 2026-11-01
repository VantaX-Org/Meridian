import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const send = vi.fn();
vi.mock("./client", () => ({ v2Get: (...a: unknown[]) => get(...a), v2Send: (...a: unknown[]) => send(...a) }));

import { createWritebackRequest, decideWriteback, getGoldenHistory, getWritebackPreview, getWritebackRequests, promoteGolden, submitWritebackRequest } from "./golden-writeback";

beforeEach(() => {
  get.mockReset().mockResolvedValue([]);
  send.mockReset().mockResolvedValue({});
});

describe("golden record clients", () => {
  it("reads the history and the preview", async () => {
    await getGoldenHistory("a/b");
    expect(get).toHaveBeenLastCalledWith("/master-records/a%2Fb/history");
    await getWritebackPreview("g1");
    expect(get).toHaveBeenLastCalledWith("/master-records/g1/writeback/preview");
  });
  it("unwraps the request list", async () => {
    get.mockResolvedValue({ requests: [{ id: "r1" }] });
    expect(await getWritebackRequests("g1")).toEqual([{ id: "r1" }]);
    expect(get).toHaveBeenLastCalledWith("/master-records/g1/writeback/requests");
  });
  it("promotes, creates, submits and decides on the right paths", async () => {
    await promoteGolden("g1");
    expect(send).toHaveBeenLastCalledWith("POST", "/master-records/g1/promote", {});
    await createWritebackRequest("g1");
    expect(send).toHaveBeenLastCalledWith("POST", "/master-records/g1/writeback/requests");
    await submitWritebackRequest("g1", "r 1");
    expect(send).toHaveBeenLastCalledWith("POST", "/master-records/g1/writeback/requests/r%201/submit");
    await decideWriteback("g1", "approve");
    expect(send).toHaveBeenLastCalledWith("POST", "/master-records/g1/writeback/approve");
    await decideWriteback("g1", "reject");
    expect(send).toHaveBeenLastCalledWith("POST", "/master-records/g1/writeback/reject");
  });
});
