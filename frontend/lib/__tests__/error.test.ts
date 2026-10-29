import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { apiErrorMessage, apiErrorState } from "../error";

const failed = (status: number, data: unknown = {}) =>
  new AxiosError("x", "ERR", undefined, undefined, { status, data, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } });

describe("apiErrorMessage", () => {
  it("prefers the API detail, names a gateway timeout, and falls back for the rest", () => {
    expect(apiErrorMessage(failed(422, { detail: "Field required" }))).toBe("Field required");
    expect(apiErrorMessage(failed(503))).toBe("The server is busy and did not answer in time. Try again.");
    // the server answered: a crash is not an outage
    expect(apiErrorMessage(failed(500))).toBe("The server could not complete the request. Try again.");
    expect(apiErrorMessage(new AxiosError("timeout", "ECONNABORTED"))).toBe("The server took too long to answer. Try again.");
    expect(apiErrorMessage(new Error("network down"))).toBe("Could not reach the server.");
  });

  it("reads the human sentence inside a structured licence refusal, so a 402 is not a fake outage", () => {
    const sentence = "This deployment's licence does not include: quality_management. Ask your administrator to add it in Meridian HQ.";
    expect(apiErrorMessage(failed(402, { detail: { error: "module_not_licenced", detail: sentence, modules: ["quality_management"] } }))).toBe(sentence);
    // an object detail without a human string still falls back — the branch must not stringify junk
    expect(apiErrorMessage(failed(402, { detail: { error: "module_not_licenced" } }))).toBe("The server could not complete the request. Try again.");
  });
});

describe("unhandled server error reference", () => {
  const detail = "Something went wrong on the server. Reference 1a2b3c4d.";
  it("shows the server's reference sentence in both the message and the error state", () => {
    const err = failed(500, { detail, reference: "1a2b3c4d" });
    expect(apiErrorMessage(err)).toBe(detail);
    expect(apiErrorState(err)).toEqual({ title: "The server could not complete the request.", message: detail });
  });
});
