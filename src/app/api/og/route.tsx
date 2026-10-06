import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { getShareCard } from "@/lib/share-meta";

export const runtime = "nodejs";

// satori cannot decode WebP, so only embed photos in formats it supports.
const embeddable = (url: string | null) => (url && /\.(png|jpe?g)(\?|$)/i.test(url) ? url : null);

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type")?.toUpperCase();
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  const allowed = ["LISTING", "SHOP", "SERVICE", "PROPERTY"];
  const card = allowed.includes(type ?? "") && slug.length < 200 ? await getShareCard(type as "LISTING", slug) : null;
  const photo = embeddable(card?.imageUrl ?? null);
  const title = card?.title ?? "Vera Market";
  const tagline = card ? card.byline : "Buy real, sell safe";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#eff6ff", fontFamily: "sans-serif" }}>
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" width={520} height={630} style={{ width: 520, height: 630, objectFit: "cover" }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 56, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 30, fontWeight: 700, color: "#1d4ed8" }}>
            <div style={{ display: "flex", width: 48, height: 48, borderRadius: 12, background: "#1d4ed8", color: "#fff", alignItems: "center", justifyContent: "center", marginRight: 14 }}>V</div>
            Vera Market
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: title.length > 50 ? 44 : 56, fontWeight: 700, color: "#0f172a", lineHeight: 1.1 }}>{title.slice(0, 90)}</div>
            {card?.priceLabel && <div style={{ display: "flex", fontSize: 48, fontWeight: 700, color: "#1d4ed8", marginTop: 20 }}>{card.priceLabel}</div>}
            <div style={{ display: "flex", fontSize: 28, color: "#475569", marginTop: 20 }}>{tagline}</div>
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#64748b" }}>Buy real, sell safe</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } },
  );
}