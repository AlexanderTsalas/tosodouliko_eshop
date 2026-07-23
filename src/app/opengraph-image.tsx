import { ImageResponse } from "next/og";
import { brand } from "@/config/brand";

export const runtime = "edge";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: brand.og.backgroundGradient,
          color: brand.og.textColor,
          fontSize: 96,
          fontWeight: 700,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {brand.name}
      </div>
    ),
    size
  );
}
