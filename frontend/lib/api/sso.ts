import apiClient from "./client";

/** GET /api/v1/auth/oidc/config: public, so the sign-in page can read it signed out. */
export interface OidcPublicConfig {
  enabled: boolean;
  display_name: string | null;
  enforce: boolean;
}

/** GET /api/v1/admin/sso (api/routes/auth_oidc.py). The client secret is write-only: only `has_secret` comes back. */
export interface SsoConfig {
  configured: boolean;
  issuer: string;
  client_id: string;
  has_secret: boolean;
  display_name: string;
  allowed_domains: string[];
  default_role: "viewer";
  enforce: boolean;
  /** The callback address to register at the identity provider, built from this deployment's own address. */
  redirect_uri: string;
}

/** PUT body. Leave `client_secret` out or empty to keep the stored secret (refused when the issuer or client ID changes). */
export interface SsoConfigInput {
  issuer: string;
  client_id: string;
  client_secret?: string;
  display_name: string;
  allowed_domains: string[];
  default_role: "viewer";
  enforce: boolean;
}

export interface SsoTestResult {
  ok: boolean;
  message: string;
}

export async function getOidcPublicConfig(): Promise<OidcPublicConfig> {
  const { data } = await apiClient.get<OidcPublicConfig>("/api/v1/auth/oidc/config");
  return data;
}

export async function getSsoConfig(): Promise<SsoConfig> {
  const { data } = await apiClient.get<SsoConfig>("/api/v1/admin/sso");
  return data;
}

export async function saveSsoConfig(input: SsoConfigInput): Promise<SsoConfig> {
  const { data } = await apiClient.put<SsoConfig>("/api/v1/admin/sso", input);
  return data;
}

export async function removeSsoConfig(): Promise<SsoConfig> {
  const { data } = await apiClient.delete<SsoConfig>("/api/v1/admin/sso");
  return data;
}

/** Fetches the provider's discovery document. Pass the issuer typed in the form to test before saving. */
export async function testSsoConfig(issuer?: string): Promise<SsoTestResult> {
  const { data } = await apiClient.post<SsoTestResult>("/api/v1/admin/sso/test", issuer ? { issuer } : {});
  return data;
}
