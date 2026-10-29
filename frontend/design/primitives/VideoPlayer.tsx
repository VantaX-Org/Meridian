"use client";

import { useState } from "react";

/**
 * A training recording for a help-centre chapter. Videos are served by
 * `GET /api/v1/docs/help-videos/{name}.mp4` — sign-in cookie, Range-aware, baked into the API
 * image like the guide markdown (see docs/help-videos.md for the recording pipeline). A
 * recording ships when its journey has been recorded; until then nothing renders (no broken
 * player, no empty "in preparation" placeholder) and the chapter reads on its own.
 */
export function VideoPlayer({ name, title }: { name: string; title: string }) {
  const [available, setAvailable] = useState(true);
  if (!available) return null;
  return (
    <figure className="m-video-frame">
      <video className="m-video" controls preload="metadata" src={`/api/v1/docs/help-videos/${name}.mp4`}
        aria-label={`${title}: training video`}
        onError={() => setAvailable(false)} />
      <figcaption className="m-text-meta">{title}</figcaption>
    </figure>
  );
}
