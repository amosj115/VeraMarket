"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ShopCategory = { id: string; name: string; slug: string; description: string | null; sortOrder: number };
type Product = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  isAvailable: boolean;
  categoryId: string | null;
  category?: { id: string; name: string; slug: string } | null;
  images: { id: string; url: string }[];
};
type ShopData = {
  id: string;
  name: string;
  description: string;
  address: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  status: string;
  isPaused: boolean;
  subscription?: { status: string | null } | null;
  categories: ShopCategory[];
  products: Product[];
};

export function ShopManagement({ shop }: { shop: ShopData }) {
  const router = useRouter();
  const [details, setDetails] = useState({
    name: shop.name,
    description: shop.description,
    address: shop.address,
    phone: shop.phone ?? "",
    email: shop.email ?? "",
    website: shop.website ?? "",
    logoUrl: shop.logoUrl ?? "",
    coverUrl: shop.coverUrl ?? "",
  });
  const [categoryForm, setCategoryForm] = useState({ name: "", description: "" });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visibleProducts = shop.products.filter((product) => {
    const haystack = `${product.name} ${product.description}`.toLowerCase();
    const matchesQuery = !productSearch || haystack.includes(productSearch.toLowerCase());
    const matchesCategory = categoryFilter === "all" || product.categoryId === categoryFilter || product.category?.slug === categoryFilter;
    return matchesQuery && matchesCategory;
  });

  async function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/uploads", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Image upload failed");
    return data.url as string;
  }

  async function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const payload = { ...details };
      const logoFile = (document.getElementById(`logo-${shop.id}`) as HTMLInputElement | null)?.files?.[0];
      const coverFile = (document.getElementById(`cover-${shop.id}`) as HTMLInputElement | null)?.files?.[0];
      if (logoFile) payload.logoUrl = await upload(logoFile);
      if (coverFile) payload.coverUrl = await upload(coverFile);
      const response = await fetch(`/api/shops/${shop.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not update shop");
      setDetails(payload);
      setNotice("Shop details saved.");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update shop.");
    }
    setBusy(false);
  }

  async function removeShop() {
    if (!window.confirm("Remove this Virtual Store from public Vera Market pages?")) return;
    setBusy(true);
    const response = await fetch(`/api/shops/${shop.id}`, { method: "DELETE" });
    const data = await response.json();
    setNotice(response.ok ? "Virtual Store removed." : data.error ?? "Could not remove store.");
    setBusy(false);
    if (response.ok) router.refresh();
  }

  async function togglePause() {
    setBusy(true);
    const response = await fetch(`/api/shops/${shop.id}/subscription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: shop.isPaused ? "reactivate" : "pause" }),
    });
    const data = await response.json();
    if (!response.ok) {
      setNotice(data.error ?? "Could not change store status.");
      setBusy(false);
      return;
    }
    setNotice(shop.isPaused ? "Store reactivated." : "Store paused.");
    setBusy(false);
    router.refresh();
  }

  async function saveCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const url = editingCategoryId ? `/api/shops/${shop.id}/categories/${editingCategoryId}` : `/api/shops/${shop.id}/categories`;
      const response = await fetch(url, {
        method: editingCategoryId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: categoryForm.name,
          description: categoryForm.description,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save category.");
      setCategoryForm({ name: "", description: "" });
      setEditingCategoryId(null);
      setNotice(editingCategoryId ? "Category updated." : "Category created.");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save category.");
    }
    setBusy(false);
  }

  async function deleteCategory(categoryId: string) {
    if (!window.confirm("Delete this category and remove it from matching products?")) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/shops/${shop.id}/categories/${categoryId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not delete category.");
      setNotice("Category removed.");
      if (categoryFilter === categoryId) setCategoryFilter("all");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete category.");
    }
    setBusy(false);
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 className="font-semibold">{shop.name}</h2>
          <p className="mt-1 text-xs text-slate-500">Marketplace status: {shop.status.replaceAll("_", " ")}</p>
          <p className="mt-1 text-xs text-slate-500">Subscription status: {shop.subscription?.status ?? "PENDING"}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={togglePause} className="text-xs font-medium text-brand hover:underline">{shop.isPaused ? "Reactivate store" : "Pause store"}</button>
          <button disabled={busy} onClick={removeShop} className="text-xs font-medium text-red-700 hover:underline">Remove store</button>
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <form onSubmit={saveDetails} className="space-y-3">
          <h3 className="text-sm font-semibold">Store details</h3>
          <Input label="Business name" value={details.name} onChange={(value) => setDetails({ ...details, name: value })} />
          <label className="block text-sm font-medium">Description
            <textarea rows={3} value={details.description} onChange={(event) => setDetails({ ...details, description: event.target.value })} className="mt-1 w-full rounded-md border border-border p-2.5 text-sm" />
          </label>
          <Input label="Address or area" value={details.address} onChange={(value) => setDetails({ ...details, address: value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Phone" value={details.phone} onChange={(value) => setDetails({ ...details, phone: value })} />
            <Input label="Email" value={details.email} onChange={(value) => setDetails({ ...details, email: value })} />
          </div>
          <Input label="Website" value={details.website} onChange={(value) => setDetails({ ...details, website: value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">Logo
              <input id={`logo-${shop.id}`} type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-xs" />
            </label>
            <label className="text-sm font-medium">Cover image
              <input id={`cover-${shop.id}`} type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-xs" />
            </label>
          </div>
          <button disabled={busy} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Save shop</button>
        </form>

        <div className="space-y-5">
          <div className="rounded-md border border-border bg-slate-50 p-3">
            <h3 className="text-sm font-semibold">Store categories</h3>
            <form onSubmit={saveCategory} className="mt-3 space-y-2">
              <Input label="Category name" value={categoryForm.name} onChange={(value) => setCategoryForm({ ...categoryForm, name: value })} />
              <label className="block text-xs font-medium text-slate-700">Description
                <textarea rows={2} value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} className="mt-1 w-full rounded-md border border-border bg-white p-2 text-sm" />
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={busy || !categoryForm.name.trim()} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">{editingCategoryId ? "Save category" : "Add category"}</button>
                {editingCategoryId && (
                  <button type="button" onClick={() => { setEditingCategoryId(null); setCategoryForm({ name: "", description: "" }); }} className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-slate-700">Cancel</button>
                )}
              </div>
            </form>
            <div className="mt-4 space-y-2">
              {shop.categories.length === 0 ? (
                <p className="text-xs text-slate-500">No custom categories yet.</p>
              ) : (
                shop.categories.map((category) => (
                  <div key={category.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-white p-2">
                    <div>
                      <p className="text-sm font-medium">{category.name}</p>
                      {category.description && <p className="text-xs text-slate-500">{category.description}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setEditingCategoryId(category.id); setCategoryForm({ name: category.name, description: category.description ?? "" }); }} className="text-xs font-medium text-brand">Edit</button>
                      <button type="button" onClick={() => deleteCategory(category.id)} className="text-xs font-medium text-red-700">Delete</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-md border border-border bg-slate-50 p-3">
            <h3 className="text-sm font-semibold">Product storefront controls</h3>
            <AddProduct shopId={shop.id} categories={shop.categories} onDone={() => router.refresh()} />
            <div className="mt-4 space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search products" className="flex-1 rounded-md border border-border bg-white px-3 py-2 text-sm" />
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-md border border-border bg-white px-3 py-2 text-sm">
                  <option value="all">All categories</option>
                  {shop.categories.map((category) => (
                    <option key={category.id} value={category.slug}>{category.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-3">
                {visibleProducts.length === 0 ? (
                  <p className="text-sm text-slate-500">No products match your current search or category filter.</p>
                ) : (
                  visibleProducts.map((product) => (
                    <ProductEditor key={product.id} shopId={shop.id} product={product} categories={shop.categories} onDone={() => router.refresh()} />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {notice && <p role="status" className="border-t border-border px-5 py-3 text-sm text-slate-600">{notice}</p>}
    </section>
  );
}

function AddProduct({ shopId, categories, onDone }: { shopId: string; categories: ShopCategory[]; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", description: "", price: "", categoryId: categories[0]?.id ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const imageUrls: string[] = [];
      const files = Array.from((document.getElementById(`product-images-${shopId}`) as HTMLInputElement | null)?.files ?? []).slice(0, 10);
      for (const file of files) {
        const imageForm = new FormData();
        imageForm.append("file", file);
        const uploadResponse = await fetch("/api/uploads", { method: "POST", body: imageForm });
        const result = await uploadResponse.json();
        if (!uploadResponse.ok) throw new Error(result.error);
        imageUrls.push(result.url);
      }
      const response = await fetch(`/api/shops/${shopId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          priceRand: Number(form.price),
          categoryId: form.categoryId || undefined,
          isAvailable: true,
          imageUrls,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not add product.");
      setForm({ name: "", description: "", price: "", categoryId: categories[0]?.id ?? "" });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add product.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-md bg-white p-3">
      <p className="text-xs font-semibold">Add product</p>
      <Input label="Product name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
      <Input label="Description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input label="Price (ZAR)" type="number" value={form.price} onChange={(value) => setForm({ ...form, price: value })} />
        <label className="block text-xs font-medium text-slate-700">Category
          <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="mt-1 w-full rounded-md border border-border bg-white px-2.5 py-2.5 text-sm">
            <option value="">No category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-xs font-medium text-slate-700">Product photos
        <input id={`product-images-${shopId}`} type="file" accept="image/jpeg,image/png,image/webp" multiple className="mt-1 block w-full" />
      </label>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button disabled={busy} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">{busy ? "Adding..." : "Add product"}</button>
    </form>
  );
}

function ProductEditor({ shopId, product, categories, onDone }: { shopId: string; product: Product; categories: ShopCategory[]; onDone: () => void }) {
  const [form, setForm] = useState({
    name: product.name,
    description: product.description,
    price: String(product.priceCents / 100),
    categoryId: product.categoryId ?? "",
    isAvailable: product.isAvailable,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const files = Array.from((document.getElementById(`edit-images-${product.id}`) as HTMLInputElement | null)?.files ?? []).slice(0, 10);
    let imageUrls: string[] | undefined;
    try {
      if (files.length) {
        imageUrls = [];
        for (const file of files) {
          const formData = new FormData();
          formData.append("file", file);
          const uploadResponse = await fetch("/api/uploads", { method: "POST", body: formData });
          const result = await uploadResponse.json();
          if (!uploadResponse.ok) throw new Error(result.error);
          imageUrls.push(result.url);
        }
      }
      const response = await fetch(`/api/shops/${shopId}/products?productId=${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          priceRand: Number(form.price),
          categoryId: form.categoryId || null,
          isAvailable: form.isAvailable,
          ...(imageUrls ? { imageUrls } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save product.");
      setNotice("Saved.");
      onDone();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save.");
    }
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm("Remove this product?")) return;
    setBusy(true);
    const response = await fetch(`/api/shops/${shopId}/products?productId=${product.id}`, { method: "DELETE" });
    if (response.ok) onDone();
    else setNotice("Could not remove product.");
    setBusy(false);
  }

  return (
    <form onSubmit={save} className="rounded-md border border-border bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
        <Input label="Price (ZAR)" type="number" value={form.price} onChange={(value) => setForm({ ...form, price: value })} />
      </div>
      <Input label="Description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-700">Category
          <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="mt-1 w-full rounded-md border border-border bg-white px-2.5 py-2 text-sm">
            <option value="">No category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">Replace photos
          <input id={`edit-images-${product.id}`} type="file" accept="image/jpeg,image/png,image/webp" multiple className="mt-1 block w-full text-xs" />
        </label>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <label className="text-xs text-slate-700"><input type="checkbox" checked={form.isAvailable} onChange={(event) => setForm({ ...form, isAvailable: event.target.checked })} className="mr-2" />Available</label>
        <div className="flex items-center gap-2">
          <button disabled={busy} className="rounded-md border border-brand px-3 py-1.5 text-xs font-semibold text-brand">Save product</button>
          <button type="button" disabled={busy} onClick={remove} className="text-xs font-medium text-red-700">Remove</button>
        </div>
      </div>
      {notice && <p role="status" className="mt-2 text-xs text-slate-500">{notice}</p>}
    </form>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block text-xs font-medium text-slate-700">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-white px-2.5 py-2 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}
