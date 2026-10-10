"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import { formatZAR } from "@/lib/utils";
import { SaveSearchButton } from "@/components/searches/save-search-button";
import { SearchActivityRecorder } from "@/components/trending/search-activity-recorder";

const RADIUS_OPTIONS = [10, 20, 50, 60, 70, 100];

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return R * c;
}

type ListingCard = {
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  location: string;
  areaName: string | null;
  latitude: number | null;
  longitude: number | null;
  category: { name: string; slug: string };
  images: Array<{ url: string }>;
};

export function MarketplaceClient({
  initialCategories,
  initialBoosts,
  initialQuery,
  initialCategory,
  initialRadius,
  initialBuyerLat,
  initialBuyerLng,
  initialSortByDistance,
}: {
  initialCategories: { id: string; name: string; slug: string }[];
  initialBoosts: Map<string, number>;
  initialQuery: string;
  initialCategory: string;
  initialRadius: number | null;
  initialBuyerLat: number | null;
  initialBuyerLng: number | null;
  initialSortByDistance: boolean;
}): React.ReactElement {
  const [query] = useState(initialQuery);
  const [category] = useState(initialCategory);
  const [radius, setRadius] = useState<number | null>(initialRadius);
  const [buyerLat, setBuyerLat] = useState<number | null>(initialBuyerLat);
  const [buyerLng, setBuyerLng] = useState<number | null>(initialBuyerLng);
  const [sortByDistance, setSortByDistance] = useState(initialSortByDistance);
  const [useMyLocation, setUseMyLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [categories] = useState(initialCategories);
  const [boosts] = useState(initialBoosts);
  const [listings, setListings] = useState<ListingCard[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch listings when filters change
  useEffect(() => {
    let active = true;

    async function fetchListings() {
      setLoading(true);
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category) params.set("category", category);
      if (radius !== null) params.set("radius", String(radius));
      if (buyerLat !== null) params.set("lat", String(buyerLat));
      if (buyerLng !== null) params.set("lng", String(buyerLng));
      if (sortByDistance) params.set("sort", "distance");

      try {
        const response = await fetch(`/api/listings?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          if (active) setListings(data.listings);
        }
      } catch (err) {
        console.error("Failed to fetch listings:", err);
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchListings();
    return () => { active = false; };
  }, [query, category, radius, buyerLat, buyerLng, sortByDistance]);

  async function handleUseMyLocation() {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by your browser.");
      return;
    }

    setUseMyLocation(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setBuyerLat(latitude);
        setBuyerLng(longitude);
        setUseMyLocation(false);
      },
      (err) => {
        setLocationError(err.message === "User denied Geolocation"
          ? "Location permission denied. You can use the manual location input."
          : "Could not get your location. Please try again or use manual input.");
        setUseMyLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function clearLocation() {
    setBuyerLat(null);
    setBuyerLng(null);
    setLocationError(null);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-sm font-medium text-brand">Marketplace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Find something real</h1><p className="mt-2 text-sm text-slate-500">Browse products listed by real people on Vera Market.</p></div>
        <Link href="/sell" className="rounded-md bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-dark">Sell something</Link>
      </div>

      {/* Search and Filters */}
      <form className="mt-8 space-y-4" method="get">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input name="q" defaultValue={query} placeholder="Search listings" className="flex-1 rounded-md border border-border px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand" />
          <select name="category" defaultValue={category} className="rounded-md border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-brand">
            <option value="">All categories</option>{categories.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}
          </select>
          <button className="rounded-md border border-brand px-5 py-2.5 text-sm font-semibold text-brand hover:bg-brand-light">Search</button>
        </div>

        {/* Distance Filter */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700">Distance:</span>
            <select
              name="radius"
              value={radius ?? ""}
              onChange={(e) => setRadius(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand"
            >
              <option value="">All distances</option>
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>{r} km</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700">Sort by:</span>
            <select
              value={sortByDistance ? "distance" : "newest"}
              onChange={(e) => setSortByDistance(e.target.value === "distance")}
              className="rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand"
            >
              <option value="newest">Newest first</option>
              <option value="distance">Distance (nearest first)</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUseMyLocation}
              disabled={useMyLocation}
              className={`rounded-md px-3 py-2 text-sm font-medium ${useMyLocation ? "bg-brand text-white" : "bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark"}`}
            >
              {useMyLocation ? "Locating..." : "Use my location"}
            </button>
            {(buyerLat !== null || buyerLng !== null) && (
              <button
                type="button"
                onClick={clearLocation}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear location
              </button>
            )}
          </div>

          {locationError && <p className="text-sm text-red-700">{locationError}</p>}
        </div>

        {/* Preserve location and sort across a full-page form submit */}
        {buyerLat !== null && <input type="hidden" name="lat" value={buyerLat} />}
        {buyerLng !== null && <input type="hidden" name="lng" value={buyerLng} />}
        {sortByDistance && <input type="hidden" name="sort" value="distance" />}
      </form>

      <SearchActivityRecorder query={query} categorySlug={category} />
      {(query || category) && <SaveSearchButton query={query} categorySlug={category} label={query || categories.find((item) => item.slug === category)?.name || "Saved search"} />}

      <div className="mt-8">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="overflow-hidden rounded-lg border border-border bg-white animate-pulse">
                <div className="aspect-square bg-slate-200" />
                <div className="mt-2 p-3 space-y-2">
                  <div className="h-4 bg-slate-200 rounded w-3/4" />
                  <div className="h-4 bg-slate-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : listings.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <p className="font-medium">{query || category ? "No listings match your search" : "No listings yet"}</p>
            <p className="mt-1 text-sm text-slate-500">{query || category ? "Try another search or browse all categories." : "Be the first person to list something on Vera Market."}</p>
            {!query && !category && <Link href="/sell" className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Create a listing</Link>}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {listings.map((listing) => (
              <Link key={listing.id} href={`/listing/${listing.slug}`} className="overflow-hidden rounded-lg border border-border bg-white hover:shadow-md">
                <div className="relative aspect-square bg-slate-100">
                  {boosts.has(listing.id) && <span className="absolute left-2 top-2 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-amber-950">Boosted</span>}
                  {listing.images[0] ? <Image src={listing.images[0].url} alt={listing.title} fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" className="object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">No image</div>}
                  {listing.latitude != null && listing.longitude != null && buyerLat != null && buyerLng != null && (
                    <span className="absolute right-2 bottom-2 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                      {Math.round(haversineDistance(buyerLat, buyerLng, listing.latitude, listing.longitude))} km
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-medium">{listing.title}</p>
                  <p className="mt-1 text-sm font-semibold text-brand">{formatZAR(listing.priceCents)}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {listing.areaName || listing.location} · {listing.category.name}
                    {listing.latitude != null && listing.longitude != null && buyerLat != null && buyerLng != null && (
                      <span className="ml-1 text-amber-600">· {Math.round(haversineDistance(buyerLat, buyerLng, listing.latitude, listing.longitude))} km</span>
                    )}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
