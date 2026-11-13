/** The window events the shell dispatches; the object page (Batch 4) listens. */
export const NX_RUN_STEP = "nx:run-step";
export const NX_UPLOAD = "nx:upload";
export const NX_DOWNLOAD = "nx:download";

/** Previous (-1) or next (1) run: the step travels in `detail`. */
export const stepRun = (dir: 1 | -1) => window.dispatchEvent(new CustomEvent<1 | -1>(NX_RUN_STEP, { detail: dir }));
export const openUpload = () => window.dispatchEvent(new Event(NX_UPLOAD));
export const openDownload = () => window.dispatchEvent(new Event(NX_DOWNLOAD));

/** True on an object page, the only place the run keys and the upload and download keys mean anything. */
export const onObjectPage = (pathname: string) => /(^|\/)o\/[^/]+\/[^/]+/.test(pathname);
