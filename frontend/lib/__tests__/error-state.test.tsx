// frontend/lib/__tests__/error-state.test.tsx
import { render, screen } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { ErrorState } from "@/design";
import { apiErrorState } from "../error";

function axiosStatus(status: number, data: unknown) {
  return new AxiosError("failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status, data, statusText: "", headers: {}, config: { headers: new AxiosHeaders() },
  });
}

describe("apiErrorState", () => {
  it("labels a 404 as not found, never as an unreachable server", () => {
    const s = apiErrorState(axiosStatus(404, { detail: "Object not found for this run" }));
    expect(s).toEqual({ title: "Not found.", message: "Object not found for this run" });
    render(<ErrorState {...s} />);
    expect(screen.getByText("Not found.")).toBeInTheDocument();
    expect(screen.queryByText(/could not reach the server/i)).toBeNull();
  });

  it("labels access and server failures by what the server answered", () => {
    expect(apiErrorState(axiosStatus(403, {})).title).toBe("You do not have access to this.");
    expect(apiErrorState(axiosStatus(500, { detail: "boom" }))).toEqual({ title: "The server could not complete the request.", message: "boom" });
  });

  it("keeps 'Could not reach the server.' for a request that got no response", () => {
    expect(apiErrorState(new AxiosError("Network Error", "ERR_NETWORK")).title).toBe("Could not reach the server.");
    expect(apiErrorState(new Error("network error")).title).toBe("Could not reach the server.");
  });
});
