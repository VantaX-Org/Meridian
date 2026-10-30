/**
 * Turns the Meridian 2 tour captures into the files the help panel plays. For every caption sidecar the recorder wrote
 * (help-videos-raw/captions/<video>.json, from e2e/guided-tours-v2.spec.ts), it converts the capture to an H.264 mp4
 * (faststart, no audio), cuts a poster frame (.jpg), writes the captions as WebVTT (.vtt) and records each recording's
 * length and size in docs/help-videos/manifest.json. The API serves all three at /api/v1/docs/help-videos/<name>.
 *
 *   node scripts/help-videos.mjs                 every captured tour
 *   node scripts/help-videos.mjs guide2-work     only these
 *
 * Needs ffmpeg and ffprobe on the PATH. Run `node scripts/help-index.mjs` afterwards so the panel knows the lengths.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(root, "help-videos-raw", "captions");
const OUT = path.join(root, "docs", "help-videos");
const MANIFEST = path.join(OUT, "manifest.json");

/** 75.5 seconds as "00:01:15.500". */
export function vttTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

/** The captions as WebVTT: one cue per tour step, never overlapping, ending where the next begins. */
export function toVtt(cues) {
  const lines = ["WEBVTT", ""];
  cues.forEach((c, i) => {
    const end = i + 1 < cues.length ? Math.min(c.end, cues[i + 1].start) : c.end;
    lines.push(String(i + 1), `${vttTime(c.start)} --> ${vttTime(end)}`, c.text, "");
  });
  return lines.join("\n");
}

const ffprobeSeconds = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

function convert(side) {
  const webm = path.join(side.outputDir, "video.webm");
  if (!existsSync(webm)) {
    const found = existsSync(side.outputDir) ? readdirSync(side.outputDir).find((f) => f.endsWith(".webm")) : null;
    if (!found) throw new Error(`no capture for ${side.video} in ${side.outputDir}`);
    return convert({ ...side, outputDir: side.outputDir, file: path.join(side.outputDir, found) });
  }
  const src = side.file ?? webm;
  const mp4 = path.join(OUT, `${side.video}.mp4`);
  const jpg = path.join(OUT, `${side.video}.jpg`);
  const vtt = path.join(OUT, `${side.video}.vtt`);
  execFileSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-i", src, "-c:v", "libx264", "-preset", "slow", "-crf", "32", "-tune", "stillimage", "-r", "15", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
  const seconds = ffprobeSeconds(mp4);
  const at = Math.min(Math.max(side.poster ?? 3, 1), Math.max(seconds - 0.5, 0));
  execFileSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-ss", String(at), "-i", mp4, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "5", jpg]);
  writeFileSync(vtt, `${toVtt(side.cues)}`);
  return { seconds: Math.round(seconds * 10) / 10, bytes: statSync(mp4).size, poster: statSync(jpg).size, chapter: side.chapter };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2);
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { about: "", videos: {} };
  manifest.about = "Meridian 2 help recordings: length in seconds and size in bytes, written by scripts/help-videos.mjs.";
  const sides = existsSync(RAW) ? readdirSync(RAW).filter((f) => f.endsWith(".json")) : [];
  let n = 0;
  for (const f of sides) {
    const side = JSON.parse(readFileSync(path.join(RAW, f), "utf8"));
    if (only.length && !only.includes(side.video)) continue;
    try {
      manifest.videos[side.video] = convert(side);
      n += 1;
      console.log(`OK  ${side.video}  ${manifest.videos[side.video].seconds}s  ${manifest.videos[side.video].bytes} bytes`);
    } catch (e) {
      console.log(`FAIL ${side.video}: ${e.message}`);
    }
  }
  manifest.videos = Object.fromEntries(Object.entries(manifest.videos).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`converted=${n}`);
}
