import { uploadApiClient } from "@/lib/api/client";
import { fixtureActive } from "./fixture";
import { fixtureDownload } from "./fixtures";

type Params = Record<string, string | number | boolean | undefined | null>;

const clean = (params?: Params): Record<string, string | number | boolean> =>
  Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Record<string, string | number | boolean>;

function saveBlob(blob: Blob, name: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * Opens a file the API builds (an export, a report): the bearer token rides on the request and the browser saves the
 * result. A refusal's `detail` becomes the Error message. In fixture mode the file is a small text stand-in.
 * `path` is relative to /api/v1. Returns the file name that was saved.
 */
export async function v2Download(path: string, params: Params | undefined, fallbackName: string): Promise<string> {
  const query = clean(params);
  if (fixtureActive()) {
    const f = fixtureDownload(path, query, fallbackName);
    saveBlob(new Blob([f.text], { type: "text/plain" }), f.name);
    return f.name;
  }
  try {
    const res = await uploadApiClient.get<Blob>(`/api/v1${path}`, { responseType: "blob", params: query });
    const disposition = String(res.headers?.["content-disposition"] ?? "");
    const hit = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ?? /filename="?([^";]+)"?/i.exec(disposition)?.[1];
    const name = hit ? decodeURIComponent(hit) : fallbackName;
    saveBlob(res.data, name);
    return name;
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
}
