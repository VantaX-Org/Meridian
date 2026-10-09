import type { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import { describe, expect, it } from "vitest";
import apiClient from "../client";

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
