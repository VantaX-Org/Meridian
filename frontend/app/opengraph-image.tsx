import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ogImage } from "@/design/brand/images";

export const alt = "Meridian: SAP data quality, measured";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (weight: 400 | 600) => readFile(join(process.cwd(), "app/_fonts", `PublicSans-${weight}.ttf`));

export default async function Image() {
  const [regular, semibold] = await Promise.all([font(400), font(600)]);
  return new ImageResponse(ogImage(), {
    ...size,
    fonts: [
      { name: "Public Sans", data: regular, weight: 400, style: "normal" },
      { name: "Public Sans", data: semibold, weight: 600, style: "normal" },
    ],
  });
}
