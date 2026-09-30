import apiClient from "./client";

function getFilenameFromDisposition(contentDisposition?: string): string | null {
  if (!contentDisposition) return null;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] ?? null;
}

export async function downloadAuthenticated(url: string, fallbackFilename: string): Promise<void> {
  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("mn_auth_token") : null;
  const response = await apiClient.get(url, {
    responseType: "blob",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const blob = response.data as Blob;
  const filename =
    getFilenameFromDisposition(response.headers?.["content-disposition"]) ??
    fallbackFilename;

  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

/** GET a file with query params; a JSON error body (e.g. a 409 gate reason) surfaces as the Error message. */
export async function downloadBlob(url: string, params: object, fallbackFilename: string): Promise<void> {
  let response;
  try {
    response = await apiClient.get<Blob>(url, { responseType: "blob", params });
  } catch (err: unknown) {
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data instanceof Blob) {
      const detail = await data
        .text()
        .then((t) => (JSON.parse(t) as { detail?: string }).detail)
        .catch(() => undefined);
      if (detail) throw new Error(detail);
    }
    throw err;
  }
  const filename = getFilenameFromDisposition(response.headers?.["content-disposition"]) ?? fallbackFilename;
  const objectUrl = window.URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}
