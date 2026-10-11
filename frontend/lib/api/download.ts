import apiClient from "./client";

function getFilenameFromDisposition(contentDisposition?: string): string | null {
  if (!contentDisposition) return null;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] ?? null;
}

/** GET a file; the API client adds the bearer token. */
export const downloadAuthenticated = (url: string, fallbackFilename: string): Promise<void> =>
  downloadBlob(url, {}, fallbackFilename);

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
