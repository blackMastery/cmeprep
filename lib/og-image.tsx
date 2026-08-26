import { ImageResponse } from "next/og";

/**
 * The shared social card, rendered by app/opengraph-image.tsx and
 * app/twitter-image.tsx.
 *
 * Deliberately built from plain divs and the default font rather than the
 * brand Poppins: ImageResponse (satori) needs font binaries fetched at
 * request time, and a font fetch that fails silently produces a blank card —
 * a worse outcome than slightly-off typography on a social preview. Colours
 * are the literal hex from globals.css, since the CSS variables don't exist
 * in this rendering context.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const CREAM = "#faf6f1";
const CRIMSON = "#7a1429";
const INK = "#1a1a1a";
const INK_MUTED = "#6b6b6b";

export function renderOgImage(input: {
  title: string;
  description: string;
  eyebrow?: string;
}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: CREAM,
          padding: "72px 80px",
        }}
      >
        {/* Wordmark: bold "cmeqbank" + light ".com", the same weight contrast
            the Logo component uses. */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", fontSize: 44, color: INK }}>
            <span style={{ fontWeight: 700 }}>cmeqbank</span>
            <span style={{ fontWeight: 400, color: CRIMSON }}>.com</span>
          </div>
          {input.eyebrow && (
            <div
              style={{
                display: "flex",
                marginLeft: 8,
                padding: "6px 18px",
                borderRadius: 999,
                backgroundColor: "#f5efe6",
                color: CRIMSON,
                fontSize: 24,
                fontWeight: 600,
              }}
            >
              {input.eyebrow}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.1,
              color: INK,
              letterSpacing: "-0.02em",
            }}
          >
            {input.title}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              lineHeight: 1.4,
              color: INK_MUTED,
              maxWidth: 900,
            }}
          >
            {input.description}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              width: 120,
              height: 8,
              borderRadius: 999,
              backgroundColor: CRIMSON,
            }}
          />
          <div style={{ display: "flex", fontSize: 24, color: INK_MUTED }}>
            CAMC · USMLE · PLAB · NCLEX · MBBS · OSCE
          </div>
        </div>
      </div>
    ),
    OG_SIZE
  );
}
