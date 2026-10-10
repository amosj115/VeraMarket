import { NextRequest, NextResponse } from "next/server";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = params.get("lat");
  const lng = params.get("lng");

  if (!lat || !lng) {
    return NextResponse.json({ error: "Latitude and longitude are required" }, { status: 400 });
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  try {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lng);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "en");

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "VeraMarket/1.0 (contact@veramarket.example)",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error("[geocode] Nominatim error:", response.status);
      return NextResponse.json({ error: "Geocoding service unavailable" }, { status: 503 });
    }

    const data = await response.json();

    // Extract a readable area name from the address components
    const address = data.address || {};
    const areaParts = [
      address.suburb,
      address.city_district,
      address.city,
      address.town,
      address.village,
      address.county,
      address.state,
    ].filter(Boolean);

    const areaName = areaParts.length > 0 ? areaParts[0] : data.display_name?.split(",")[0] || "Unknown area";

    return NextResponse.json({
      areaName,
      displayName: data.display_name,
      latitude,
      longitude,
      address,
    });
  } catch (error) {
    console.error("[geocode] Reverse geocoding error:", error);
    return NextResponse.json({ error: "Geocoding failed" }, { status: 500 });
  }
}