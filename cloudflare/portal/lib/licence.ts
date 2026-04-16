const LICENCE_WORKER_URL =
  process.env.LICENCE_WORKER_URL || "https://licence.meridian.vantax.co.za";
const ADMIN_SECRET = process.env.LICENCE_ADMIN_SECRET || "";

interface LicenceStatus {
  valid: boolean;
  expiresAt: string;
  daysRemaining: number;
  modules: string[];
  features: string[];
}

interface ProvisionResult {
  licenceKey: string;
  tenantId: string;
  modules: string[];
  expiresAt: string;
}

interface PingEntry {
  licenceKey: string;
  lastSeen: string;
  machineFingerprint: string;
}

async function adminFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${LICENCE_WORKER_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Secret": ADMIN_SECRET,
      ...(options.headers || {}),
    },
  });
}

export async function getLicenceStatus(key: string): Promise<LicenceStatus> {
  const resp = await fetch(
    `${LICENCE_WORKER_URL}/status?key=${encodeURIComponent(key)}`
  );
  if (!resp.ok) {
    throw new Error(`Licence status check failed: ${resp.status}`);
  }
  return resp.json();
}

export async function provisionLicence(
  tenantId: string,
  modules: string[],
  expiresAt: string,
  notes?: string
): Promise<ProvisionResult> {
  const resp = await adminFetch("/provision", {
    method: "POST",
    body: JSON.stringify({ tenantId, modules, expiresAt, notes }),
  });
  if (!resp.ok) {
    throw new Error(`Licence provision failed: ${resp.status}`);
  }
  return resp.json();
}

export async function revokeLicence(
  licenceKey: string
): Promise<{ revoked: boolean }> {
  const resp = await adminFetch("/revoke", {
    method: "POST",
    body: JSON.stringify({ licenceKey }),
  });
  if (!resp.ok) {
    throw new Error(`Licence revoke failed: ${resp.status}`);
  }
  return resp.json();
}

export async function addFeatureToLicence(
  licenceKey: string,
  feature: string
): Promise<{ features: string[] }> {
  // Read current record, add feature, write back
  const status = await getLicenceStatus(licenceKey);
  const features = [...new Set([...(status.features || []), feature])];
  const resp = await adminFetch("/update-features", {
    method: "POST",
    body: JSON.stringify({ licenceKey, features }),
  });
  if (!resp.ok) {
    throw new Error(`Add feature failed: ${resp.status}`);
  }
  return resp.json();
}

export async function removeFeatureFromLicence(
  licenceKey: string,
  feature: string
): Promise<{ features: string[] }> {
  const status = await getLicenceStatus(licenceKey);
  const features = (status.features || []).filter((f) => f !== feature);
  const resp = await adminFetch("/update-features", {
    method: "POST",
    body: JSON.stringify({ licenceKey, features }),
  });
  if (!resp.ok) {
    throw new Error(`Remove feature failed: ${resp.status}`);
  }
  return resp.json();
}

export async function getLicencePings(
  licenceKey?: string
): Promise<{ pings: PingEntry[] }> {
  const path = licenceKey
    ? `/pings?licenceKey=${encodeURIComponent(licenceKey)}`
    : "/pings";
  const resp = await adminFetch(path);
  if (!resp.ok) {
    throw new Error(`Pings fetch failed: ${resp.status}`);
  }
  return resp.json();
}
