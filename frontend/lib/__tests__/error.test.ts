import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "../error";

const failed = (status: number, data: unknown = {}) =>
  new AxiosError("x", "ERR", undefined, undefined, { status, data, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } });

describe("apiErrorMessage", () => {
  it("prefers the API detail, names a gateway timeout, and falls back for the rest", () => {
    expect(apiErrorMessage(failed(422, { detail: "Field required" }))).toBe("Field required");
    expect(apiErrorMessage(failed(503))).toBe("The server is busy and did not answer in time. Try again.");
    expect(apiErrorMessage(failed(500))).toBe("Could not reach the server.");
    expect(apiErrorMessage(new Error("network down"))).toBe("Could not reach the server.");
  });
});
