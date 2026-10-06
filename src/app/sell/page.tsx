"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  function update(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
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

      const response = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          priceRand: Number(form.priceRand),
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
          onChange={(value) => update("title", value)}
        />
        <label className="block text-sm font-medium">
          Description
          <textarea
            required
            minLength={10}
            maxLength={5000}
            rows={5}
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
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
            onChange={(value) => update("priceRand", value)}
          />
          <label className="block text-sm font-medium">
            Category
            <select
              required
              value={form.categoryId}
              disabled={categoriesLoading || categories.length === 0}
              onChange={(event) => update("categoryId", event.target.value)}
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
              onChange={(event) => update("condition", event.target.value)}
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
            onChange={(value) => update("location", value)}
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
