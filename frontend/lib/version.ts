import pkg from "../package.json";

/** The version shown in the UI: the build's `NEXT_PUBLIC_APP_VERSION` when set (the release image), else package.json. A leading `v` is dropped so a tag and `/health` read the same. */
export const APP_VERSION: string = (process.env.NEXT_PUBLIC_APP_VERSION || pkg.version).replace(/^v/i, "");
