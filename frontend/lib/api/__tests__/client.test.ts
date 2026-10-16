import { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it, vi } from "vitest";
import apiClient, { isRetryable } from "../client";

// axios doesn't publicly type the interceptor manager's internal handler
// list, but it's the only way to invoke the request interceptor directly
// without making a real network call.
interface InterceptorManagerWithHandlers {
  handlers: Array<{ fulfilled?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig } | null>;
}

function runRequestInterceptors(client: AxiosInstance, config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  const manager = client.interceptors.request as unknown as InterceptorManagerWithHandlers;
  let result = config;
  for (const handler of manager.handlers) {
    if (handler?.fulfilled) result = handler.fulfilled(result);
  }
  return result;
}

describe("apiClient per_page clamp", () => {
  it("clamps a per_page above the backend cap down to 100", () => {
    const config = runRequestInterceptors(apiClient, {
      params: { per_page: 500 },
      headers: {},
    } as InternalAxiosRequestConfig);
    expect(config.params.per_page).toBe(100);
  });

  it("leaves a per_page at or below the cap untouched", () => {
    const config = runRequestInterceptors(apiClient, {
      params: { per_page: 50 },
      headers: {},
    } as InternalAxiosRequestConfig);
    expect(config.params.per_page).toBe(50);
  });

  it("leaves requests with no per_page param untouched", () => {
    const config = runRequestInterceptors(apiClient, {
      params: undefined,
      headers: {},
    } as InternalAxiosRequestConfig);
    expect(config.params).toBeUndefined();
  });
});

interface ResponseManagerWithHandlers {
  handlers: Array<{ rejected?: (error: unknown) => Promise<unknown> } | null>;
}

async function runResponseErrorInterceptors(client: AxiosInstance, error: unknown): Promise<void> {
  const manager = client.interceptors.response as unknown as ResponseManagerWithHandlers;
  for (const handler of manager.handlers) {
    if (handler?.rejected) await handler.rejected(error).catch(() => undefined);
  }
}

describe("apiClient 401 handling", () => {
  const error = (status: number) => ({
    config: { url: "/api/v1/auth/change-password", method: "post" },
    response: { status, data: { detail: "Current password is incorrect" } },
  });

  it("keeps the session when change-password rejects the current password (422)", async () => {
    localStorage.setItem("mn_auth_token", "t");
    await runResponseErrorInterceptors(apiClient, error(422));
    expect(localStorage.getItem("mn_auth_token")).toBe("t");
  });

  it("clears the session on a 401 from any non-login call", async () => {
    localStorage.setItem("mn_auth_token", "t");
    await runResponseErrorInterceptors(apiClient, error(401));
    expect(localStorage.getItem("mn_auth_token")).toBeNull();
  });
});

describe("apiClient retry of an idempotent GET", () => {
  const fail = (config: InternalAxiosRequestConfig, status?: number, data: unknown = "Internal Server Error", code = "ERR_BAD_RESPONSE") =>
    new AxiosError("failed", status ? code : "ECONNRESET", config, null, status ? { status, data, statusText: "", headers: {}, config } : undefined);

  /** An adapter that fails `failures` times with `make`, then answers 200. */
  function flaky(failures: number, make: (config: InternalAxiosRequestConfig) => AxiosError) {
    const calls = vi.fn();
    const adapter = async (config: InternalAxiosRequestConfig) => {
      calls();
      if (calls.mock.calls.length <= failures) throw make(config);
      return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
    };
    return { adapter, calls };
  }

  it("retries a GET once on a proxy 502, 503 or 504, and on a connection reset", async () => {
    for (const make of [(c: InternalAxiosRequestConfig) => fail(c, 502), (c: InternalAxiosRequestConfig) => fail(c, 503), (c: InternalAxiosRequestConfig) => fail(c, 504), (c: InternalAxiosRequestConfig) => fail(c)]) {
      const { adapter, calls } = flaky(1, make);
      const res = await apiClient.get("/api/v1/settings/cost-model", { adapter });
      expect(res.data).toEqual({ ok: true });
      expect(calls).toHaveBeenCalledTimes(2);
    }
  });

  it("retries the proxy's own plain-text 500, never the API's JSON 500", async () => {
    const proxy = flaky(1, (c) => fail(c, 500, "Internal Server Error"));
    await expect(apiClient.get("/api/v1/jobs", { adapter: proxy.adapter })).resolves.toMatchObject({ status: 200 });
    expect(proxy.calls).toHaveBeenCalledTimes(2);
    const api = flaky(1, (c) => fail(c, 500, { detail: "boom" }));
    await expect(apiClient.get("/api/v1/jobs", { adapter: api.adapter })).rejects.toMatchObject({ response: { status: 500 } });
    expect(api.calls).toHaveBeenCalledTimes(1);
  });

  it("retries only once, and never a POST, PUT or DELETE", async () => {
    const twice = flaky(2, (c) => fail(c, 503));
    await expect(apiClient.get("/api/v1/jobs", { adapter: twice.adapter })).rejects.toMatchObject({ response: { status: 503 } });
    expect(twice.calls).toHaveBeenCalledTimes(2);
    for (const method of ["post", "put", "delete"] as const) {
      const once = flaky(1, (c) => fail(c, 503));
      await expect(apiClient.request({ url: "/api/v1/jobs", method, adapter: once.adapter })).rejects.toMatchObject({ response: { status: 503 } });
      expect(once.calls).toHaveBeenCalledTimes(1);
    }
  });

  it("never retries a timeout or a client error", () => {
    expect(isRetryable({ code: "ECONNABORTED", config: { method: "get" } })).toBe(false);
    expect(isRetryable({ config: { method: "get" }, response: { status: 404, data: { detail: "nf" } } })).toBe(false);
    expect(isRetryable({ config: { method: "get", retried: true }, response: { status: 503 } })).toBe(false);
  });
});
