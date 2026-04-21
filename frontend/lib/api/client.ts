import axios, { AxiosInstance } from "axios";

const TOKEN_KEY = "mn_auth_token";

// Attach auth + error interceptors to an axios instance
function instrument(client: AxiosInstance): AxiosInstance {
  client.interceptors.request.use((config) => {
    if (typeof window === "undefined") return config;
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (typeof window !== "undefined" && error.response) {
        if (error.response.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          window.location.href = "/sign-in";
          return Promise.reject(error);
        }
        // Don't redirect on 402 - let components handle missing features gracefully
      }
      return Promise.reject(error);
    }
  );
  return client;
}

// Short timeout (30s) — snappy UI endpoints
const apiClient = instrument(axios.create({
  baseURL: "",
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
}));

// Long timeout (180s) — LLM-dependent endpoints (NLP, AI enrichment, agent runs)
export const longApiClient = instrument(axios.create({
  baseURL: "",
  timeout: 180_000,
  headers: { "Content-Type": "application/json" },
}));

// Very long timeout (300s) — uploads, exports, PDF generation
export const uploadApiClient = instrument(axios.create({
  baseURL: "",
  timeout: 300_000,
  headers: { "Content-Type": "application/json" },
}));

export default apiClient;
