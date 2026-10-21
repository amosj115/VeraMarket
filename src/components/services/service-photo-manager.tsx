"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cdnImage } from "@/lib/image-url";
import { prepareImageForUpload, UPLOAD_TIMEOUT_MS } from "@/lib/client-image";
import { canAddServicePortfolioPhotos, SERVICE_PORTFOLIO_LIMIT } from "@/lib/service-gallery";

type PortfolioPhoto = { id: string; url: string; sortOrder: number };
type PendingPhoto = { previewUrl: string; file: File };

function responseError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

function isPortfolioPhoto(value: unknown): value is PortfolioPhoto {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "url" in value &&
    typeof value.url === "string" &&
    "sortOrder" in value &&
    typeof value.sortOrder === "number"
  );
}

async function postPhoto(serviceId: string, form: FormData): Promise<unknown> {
  const response = await fetch(`/api/services/${serviceId}/images`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body, "The photo couldn't be saved. Please try again."));
  return body;
}

export function ServicePhotoManager({
  serviceId,
  serviceTitle,
  initialCoverUrl,
  initialPhotos,
}: {
  serviceId: string;
  serviceTitle: string;
  initialCoverUrl: string | null;
  initialPhotos: PortfolioPhoto[];
}) {
  const [coverUrl, setCoverUrl] = useState(initialCoverUrl);
  const [coverPending, setCoverPending] = useState<PendingPhoto | null>(null);
  const [photos, setPhotos] = useState(initialPhotos);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const previewUrls = useRef(new Set<string>());
  const remaining = Math.max(0, SERVICE_PORTFOLIO_LIMIT - photos.length);

  useEffect(
    () => () => {
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current.clear();
    },
    []
  );

  function createPending(file: File): PendingPhoto {
    const previewUrl = URL.createObjectURL(file);
    previewUrls.current.add(previewUrl);
    return { file, previewUrl };
  }

  function revokePreview(url: string) {
    URL.revokeObjectURL(url);
    previewUrls.current.delete(url);
  }

  function showError(value: unknown, fallback: string) {
    setError(value instanceof Error ? value.message : fallback);
    setNotice(null);
  }

  async function uploadCover() {
    if (!coverPending || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const file = await prepareImageForUpload(coverPending.file);
      const form = new FormData();
      form.set("kind", "cover");
      form.set("file", file, file.name);
      const body = await postPhoto(serviceId, form);
      if (!body || typeof body !== "object" || !("coverImageUrl" in body) || typeof body.coverImageUrl !== "string") {
        throw new Error("The server did not confirm the cover photo. Please try again.");
      }
      setCoverUrl(body.coverImageUrl);
      revokePreview(coverPending.previewUrl);
      setCoverPending(null);
      setNotice("Business cover photo saved.");
    } catch (uploadError) {
      showError(uploadError, "The cover photo couldn't be saved.");
    }
    setBusy(false);
  }

  async function removeCover() {
    if (busy || !coverUrl) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/services/${serviceId}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: null }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, "The cover photo couldn't be removed."));
      setCoverUrl(null);
      setNotice("Business cover photo removed.");
    } catch (removeError) {
      showError(removeError, "The cover photo couldn't be removed.");
    }
    setBusy(false);
  }

  function choosePortfolioPhotos(event: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setNotice(null);
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;
    const pendingCount = pendingPhotos.length;
    if (!canAddServicePortfolioPhotos(photos.length, pendingCount + files.length)) {
      setError(
        remaining <= pendingCount
          ? `Your portfolio is full. Remove a photo before adding another.`
          : `You can select up to ${remaining - pendingCount} more portfolio photo${remaining - pendingCount === 1 ? "" : "s"}.`
      );
      return;
    }
    setPendingPhotos((current) => [...current, ...files.map(createPending)]);
  }

  function removePendingPhoto(photo: PendingPhoto) {
    revokePreview(photo.previewUrl);
    setPendingPhotos((current) => current.filter((item) => item.previewUrl !== photo.previewUrl));
  }

  async function uploadPortfolioPhotos() {
    if (busy || !pendingPhotos.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let uploaded = 0;

    for (const pending of pendingPhotos) {
      try {
        const file = await prepareImageForUpload(pending.file);
        const form = new FormData();
        form.set("kind", "portfolio");
        form.set("file", file, file.name);
        const body = await postPhoto(serviceId, form);
        if (!body || typeof body !== "object" || !("image" in body) || !isPortfolioPhoto(body.image)) {
          throw new Error("The server didn't confirm the portfolio photo. Please try again.");
        }
        const image = body.image;
        setPhotos((current) => [...current, { id: image.id, url: image.url, sortOrder: image.sortOrder }]);
        setPendingPhotos((current) => current.filter((item) => item.previewUrl !== pending.previewUrl));
        revokePreview(pending.previewUrl);
        uploaded += 1;
      } catch (uploadError) {
        showError(uploadError, "A portfolio photo couldn't be saved.");
        break;
      }
    }

    if (uploaded > 0) setNotice(`${uploaded} portfolio photo${uploaded === 1 ? "" : "s"} saved.`);
    setBusy(false);
  }

  async function setCoverFromPortfolio(photo: PortfolioPhoto | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/services/${serviceId}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: photo?.id ?? null }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, "The cover photo couldn't be updated."));
      if (!body || typeof body !== "object" || !("coverImageUrl" in body)) {
        throw new Error("The server didn't confirm the cover photo change.");
      }
      setCoverUrl(typeof body.coverImageUrl === "string" ? body.coverImageUrl : null);
      if (coverPending) {
        revokePreview(coverPending.previewUrl);
        setCoverPending(null);
      }
      setNotice(photo ? "Portfolio photo selected as the cover." : "Business cover photo removed.");
    } catch (updateError) {
      showError(updateError, "The cover photo couldn't be updated.");
    }
    setBusy(false);
  }

  async function deletePortfolioPhoto(photo: PortfolioPhoto) {
    if (busy || !window.confirm("Remove this portfolio photo?")) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/services/${serviceId}/images?imageId=${encodeURIComponent(photo.id)}`,
        { method: "DELETE" }
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, "The portfolio photo couldn't be removed."));
      setPhotos((current) => current.filter((item) => item.id !== photo.id));
      setNotice("Portfolio photo removed.");
    } catch (deleteError) {
      showError(deleteError, "The portfolio photo couldn't be removed.");
    }
    setBusy(false);
  }

  const displayedCover = coverPending?.previewUrl ?? coverUrl;

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border bg-white p-4 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Business Cover Photo</h2>
          <p className="mt-1 text-sm text-slate-500">
            Choose one main photo to represent {serviceTitle}.
          </p>
        </div>
        <label className="mt-4 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:w-auto">
            {coverUrl || coverPending ? "Choose a different cover photo" : "Choose cover photo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              disabled={busy}
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                if (coverPending) revokePreview(coverPending.previewUrl);
                setCoverPending(createPending(file));
                setError(null);
                setNotice(null);
              }}
            />
        </label>
        <div className="relative mt-3 aspect-[16/8] overflow-hidden rounded-lg bg-slate-100 sm:aspect-[16/6]">
          {displayedCover ? (
            <Image
              src={coverPending ? displayedCover : cdnImage(displayedCover, 1440)}
              alt={`${serviceTitle} business cover`}
              fill
              sizes="(max-width: 640px) 100vw, 768px"
              unoptimized={Boolean(coverPending)}
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 px-4 text-center text-sm text-slate-500">
              Your cover photo preview will appear here.
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {coverPending && (
            <button
              type="button"
              disabled={busy}
              onClick={uploadCover}
              className="min-h-11 w-full rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 sm:w-auto"
            >
              {busy ? "Saving photo…" : "Save cover photo"}
            </button>
          )}
          {coverUrl && !coverPending && (
            <button
              type="button"
              disabled={busy}
              onClick={removeCover}
              className="min-h-11 w-full rounded-md px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 sm:w-auto"
            >
              Remove cover
            </button>
          )}
        </div>
        {coverPending && <p className="mt-2 text-xs text-slate-500">Preview selected. Save it to publish this cover photo.</p>}
      </section>

      <section className="rounded-xl border border-border bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Portfolio — Showcase Your Work</h2>
            <p className="mt-1 text-sm text-slate-500">
              Add completed jobs that help customers understand the work you do.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
            {photos.length}/{SERVICE_PORTFOLIO_LIMIT}
          </span>
        </div>

        <div className="mt-5 space-y-3">
          <p className="text-xs text-slate-500">
            JPEG, PNG, and WebP · up to {SERVICE_PORTFOLIO_LIMIT} work photos · each photo is optimized before upload.
          </p>
          <label
            className={`inline-flex min-h-11 w-full items-center justify-center rounded-md border px-4 py-2 text-sm font-medium sm:w-auto ${
              remaining > 0
                ? "cursor-pointer border-border text-slate-700 hover:bg-slate-50"
                : "cursor-not-allowed border-border text-slate-400"
            }`}
          >
            {remaining > 0 ? "Select portfolio photos" : `Portfolio full (${SERVICE_PORTFOLIO_LIMIT}/${SERVICE_PORTFOLIO_LIMIT})`}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              disabled={busy || remaining === 0}
              className="sr-only"
              onChange={choosePortfolioPhotos}
            />
          </label>

          {pendingPhotos.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">
                Preview selected photos ({pendingPhotos.length})
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {pendingPhotos.map((photo) => (
                  <div key={photo.previewUrl} className="overflow-hidden rounded-lg border border-border">
                    <div className="relative aspect-square bg-slate-100">
                      <Image
                        src={photo.previewUrl}
                        alt={`Preview: ${photo.file.name}`}
                        fill
                        sizes="(max-width: 640px) 50vw, 33vw"
                        unoptimized
                        className="object-cover"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 p-2">
                      <span className="truncate text-xs text-slate-500">{photo.file.name}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => removePendingPhoto(photo)}
                        className="shrink-0 text-xs font-medium text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={uploadPortfolioPhotos}
                className="min-h-11 w-full rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 sm:w-auto"
              >
                {busy
                  ? "Uploading photos…"
                  : `Upload ${pendingPhotos.length} Photo${pendingPhotos.length === 1 ? "" : "s"}`}
              </button>
            </div>
          )}
        </div>

        {photos.length > 0 ? (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((photo) => (
              <article key={photo.id} className="overflow-hidden rounded-lg border border-border">
                <div className="relative aspect-square bg-slate-100">
                  <Image
                    src={cdnImage(photo.url, 640)}
                    alt={`${serviceTitle} portfolio photo`}
                    fill
                    sizes="(max-width: 640px) 50vw, 33vw"
                    className="object-cover"
                  />
                  {coverUrl === photo.url && (
                    <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-1 text-[11px] font-semibold text-brand shadow-sm">
                      Cover photo
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 p-2">
                  {coverUrl !== photo.url && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCoverFromPortfolio(photo)}
                      className="min-h-9 flex-1 rounded-md bg-blue-50 px-2 text-xs font-medium text-brand hover:bg-blue-100 disabled:opacity-60"
                    >
                      Use as cover
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => deletePortfolioPhoto(photo)}
                    className="min-h-9 rounded-md px-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-slate-500">
            Your completed-work photos will appear here.
          </p>
        )}
      </section>

      {error && <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</p>}
    </div>
  );
}
