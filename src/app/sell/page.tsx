"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

// Leaflet accesses `window` at import time, so it must never render on the server.
const Map = dynamic(() => import("@/components/map/Map").then((mod) => mod.Map), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-border bg-slate-50 text-sm text-slate-500">
      Loading map...
    </div>
  ),
});

type Category = { id: string; name: string };

function isCategoryList(value: unknown): value is Category[] {
  return (
    Array.isArray(value) &&
    value.every(
      (category) =>
        category &&
        typeof category.id === "string" &&
        typeof category.name === "string"
    )
  );
}

function messageFrom(value: unknown, fallback: string): string {
  if (
    value &&
    typeof value === "object" &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return fallback;
}

export default function SellPage() {
  const router = useRouter();
  const submittingRef = useRef(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [categoryRetry, setCategoryRetry] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState({
    title: "",
    description: "",
    priceRand: "",
    categoryId: "",
    condition: "GOOD",
    location: "",
    latitude: "" as string | number,
    longitude: "" as string | number,
    areaName: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [useGeolocation, setUseGeolocation] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadCategories() {
      setCategoriesLoading(true);
      setCategoriesError(null);
      try {
        const response = await fetch("/api/categories?domain=MARKETPLACE");
        const payload: unknown = await response.json().catch(() => null);
        const categoryData =
          payload && typeof payload === "object" && "categories" in payload
            ? payload.categories
            : null;

        if (!response.ok || !isCategoryList(categoryData)) {
          throw new Error("Categories could not be loaded.");
        }
        if (active) {
          setCategories(categoryData);
          if (categoryData.length === 0) {
            setCategoriesError("No listing categories are available right now.");
          }
        }
      } catch {
        if (active) {
          setCategories([]);
          setCategoriesError("Categories could not be loaded. Please try again.");
        }
      } finally {
        if (active) setCategoriesLoading(false);
      }
    }

    void loadCategories();
    return () => {
      active = false;
    };
  }, [categoryRetry]);

  async function handleGeolocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }

    setError(null);
    setUseGeolocation(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setForm((prev) => ({ ...prev, latitude, longitude }));

        // Reverse geocode to get area name
        try {
          const response = await fetch(`/api/geocode/reverse?lat=${latitude}&lng=${longitude}`);
          if (response.ok) {
            const data = await response.json();
            if (data.areaName) {
              setForm((prev) => ({ ...prev, areaName: data.areaName }));
            }
          }
        } catch {
          // Ignore geocoding errors
        }
      },
      (err) => {
        setError(err.message === "User denied Geolocation"
          ? "Location permission denied. You can enter the location manually."
          : "Could not get your location. Please try again or enter manually.");
        setUseGeolocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function updateForm(key: string, value: string | number) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleMapClick(lat: number, lng: number) {
    setForm((prev) => ({ ...prev, latitude: lat, longitude: lng }));
    // Reverse geocode on map click
    fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`)
      .then((res) => res.ok && res.json())
      .then((data) => {
        if (data.areaName) {
          setForm((prev) => ({ ...prev, areaName: data.areaName }));
        }
      })
      .catch(() => {});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setBusy(true);

    try {
      if (!files.length) throw new Error("Add at least one photo.");

      const imageUrls: string[] = [];
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/api/uploads", {
          method: "POST",
          body,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            messageFrom(payload, "Could not upload an image. Please try again.")
          );
        }
        if (
          !payload ||
          typeof payload !== "object" ||
          !("url" in payload) ||
          typeof payload.url !== "string"
        ) {
          throw new Error("The image upload did not return a valid image.");
        }
        imageUrls.push(payload.url);
      }

      const { ...restForm } = form;
      const response = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...restForm,
          priceRand: Number(form.priceRand),
          latitude: form.latitude ? Number(form.latitude) : undefined,
          longitude: form.longitude ? Number(form.longitude) : undefined,
          areaName: form.areaName || undefined,
          imageUrls,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          messageFrom(payload, "Could not submit the listing. Please try again.")
        );
      }

      router.push("/profile/listings?submitted=1");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not publish listing."
      );
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <p className="text-sm font-medium text-brand">Sell something</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">
        Create a listing
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        New listings are reviewed before they appear publicly.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <label className="block text-sm font-medium">
          Photos
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            required
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              setFiles(selected.slice(0, 10));
              setError(
                selected.length > 10
                  ? "Choose up to 10 photos."
                  : null
              );
            }}
            className="mt-2 block w-full rounded-md border border-border p-2 text-sm"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Up to 10 images, 5MB each. JPEG, PNG or WEBP.
          </span>
        </label>

        <Field
          label="Title"
          value={form.title}
          onChange={(value) => updateForm("title", value)}
        />
        <label className="block text-sm font-medium">
          Description
          <textarea
            required
            minLength={10}
            maxLength={5000}
            rows={5}
            value={form.description}
            onChange={(event) => updateForm("description", event.target.value)}
            className="mt-1 w-full rounded-md border border-border p-3 text-sm outline-none focus:border-brand"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Price (ZAR)"
            type="number"
            min="0"
            max="100000000"
            step="0.01"
            value={form.priceRand}
            onChange={(value) => updateForm("priceRand", value)}
          />
          <label className="block text-sm font-medium">
            Category
            <select
              required
              value={form.categoryId}
              disabled={categoriesLoading || categories.length === 0}
              onChange={(event) => updateForm("categoryId", event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-white p-2.5 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              <option value="">
                {categoriesLoading ? "Loading categories..." : "Select category"}
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {categoriesError && (
              <span role="alert" className="mt-1 block text-xs text-red-700">
                {categoriesError}
                <button
                  type="button"
                  onClick={() => setCategoryRetry((attempt) => attempt + 1)}
                  className="ml-1 font-semibold underline"
                >
                  Retry
                </button>
              </span>
            )}
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Condition
            <select
              required
              value={form.condition}
              onChange={(event) => updateForm("condition", event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-white p-2.5 text-sm"
            >
              <option value="NEW">New</option>
              <option value="LIKE_NEW">Like new</option>
              <option value="GOOD">Good</option>
              <option value="FAIR">Fair</option>
              <option value="FOR_PARTS">For parts</option>
            </select>
          </label>
          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Location
              <input
                type="text"
                value={form.location}
                onChange={(event) => updateForm("location", event.target.value)}
                placeholder="e.g., Cape Town CBD"
                className="mt-1 w-full rounded-md border border-border p-2.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleGeolocation}
                disabled={busy || useGeolocation}
                className="flex-1 rounded-md border border-brand px-3 py-2 text-sm font-medium text-brand hover:bg-blue-50 disabled:opacity-50"
              >
                {useGeolocation ? "Locating..." : "Use my location"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm((prev) => ({ ...prev, latitude: "", longitude: "", areaName: "" }));
                }}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
            {form.latitude && form.longitude && (
              <p className="text-xs text-slate-500">
                GPS: {Number(form.latitude).toFixed(6)}, {Number(form.longitude).toFixed(6)}
                {form.areaName && ` — ${form.areaName}`}
              </p>
            )}
          </div>
        </div>

        {useGeolocation && !form.latitude && (
          <p className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded">
            Getting your location... please wait.
          </p>
        )}

        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Location on map
            <div className="mt-2">
              {form.latitude && form.longitude ? (
                <Map
                  latitude={Number(form.latitude)}
                  longitude={Number(form.longitude)}
                  readOnly={false}
                  onLocationChange={handleMapClick}
                  height="300px"
                  areaName={form.areaName}
                />
              ) : (
                <div className="aspect-video rounded-lg border border-dashed border-border flex items-center justify-center bg-slate-50">
                  <p className="text-sm text-slate-500">Click &quot;Use my location&quot; or drag on map to set location</p>
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Drag the marker to adjust the approximate location. Your exact address is never shown publicly.
            </p>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Price (ZAR)"
            type="number"
            min="0"
            max="100000000"
            step="0.01"
            value={form.priceRand}
            onChange={(value) => updateForm("priceRand", value)}
          />
          <label className="block text-sm font-medium">
            Category
            <select
              required
              value={form.categoryId}
              disabled={categoriesLoading || categories.length === 0}
              onChange={(event) => updateForm("categoryId", event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-white p-2.5 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              <option value="">
                {categoriesLoading ? "Loading categories..." : "Select category"}
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {categoriesError && (
              <span role="alert" className="mt-1 block text-xs text-red-700">
                {categoriesError}
                <button
                  type="button"
                  onClick={() => setCategoryRetry((attempt) => attempt + 1)}
                  className="ml-1 font-semibold underline"
                >
                  Retry
                </button>
              </span>
            )}
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Condition
            <select
              required
              value={form.condition}
              onChange={(event) => updateForm("condition", event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-white p-2.5 text-sm"
            >
              <option value="NEW">New</option>
              <option value="LIKE_NEW">Like new</option>
              <option value="GOOD">Good</option>
              <option value="FAIR">Fair</option>
              <option value="FOR_PARTS">For parts</option>
            </select>
          </label>
          <Field
            label="Location"
            value={form.location}
            onChange={(value) => updateForm("location", value)}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || categoriesLoading || categories.length === 0}
          className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? "Submitting..." : "Submit for review"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  min,
  max,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        required
        type={type}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-border p-2.5 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}
