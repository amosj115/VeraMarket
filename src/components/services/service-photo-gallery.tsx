"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cdnImage } from "@/lib/image-url";

type PortfolioPhoto = { id: string; url: string };

export function ServicePhotoGallery({
  title,
  photos,
}: {
  title: string;
  photos: PortfolioPhoto[];
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const isOpen = activeIndex !== null;

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveIndex(null);
      if (event.key === "ArrowRight") {
        setActiveIndex((index) => (index === null ? null : (index + 1) % photos.length));
      }
      if (event.key === "ArrowLeft") {
        setActiveIndex((index) => (index === null ? null : (index - 1 + photos.length) % photos.length));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, photos.length]);

  if (photos.length === 0) return null;
  const activePhoto = activeIndex === null ? null : photos[activeIndex];
  const currentIndex = activeIndex ?? 0;

  function move(direction: -1 | 1) {
    setActiveIndex((index) =>
      index === null ? null : (index + direction + photos.length) % photos.length
    );
  }

  return (
    <>
      <section aria-labelledby="service-portfolio-heading" className="mt-8">
        <div className="mb-4">
          <h2 id="service-portfolio-heading" className="text-xl font-semibold">
            Portfolio — Showcase Their Work
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Examples of completed work by this service provider.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`View portfolio photo ${index + 1} of ${photos.length}`}
              className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              <Image
                src={cdnImage(photo.url, 720)}
                alt={`${title} completed-work example ${index + 1}`}
                fill
                sizes="(max-width: 640px) 50vw, 33vw"
                className="object-cover transition duration-300 group-hover:scale-[1.03]"
              />
            </button>
          ))}
        </div>
      </section>

      {activePhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${title} portfolio photo ${currentIndex + 1} of ${photos.length}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) setActiveIndex(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-3 sm:p-8"
        >
          <button
            type="button"
            aria-label="Close photo viewer"
            onClick={() => setActiveIndex(null)}
            className="absolute right-4 top-4 z-10 rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/25"
          >
            Close
          </button>
          {photos.length > 1 && (
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => move(-1)}
              className="absolute left-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25 sm:left-6"
            >
              ‹
            </button>
          )}
          <div className="relative h-[min(78vh,900px)] w-full max-w-6xl">
            <Image
              src={cdnImage(activePhoto.url, 1920)}
              alt={`${title} portfolio photo ${currentIndex + 1}`}
              fill
              sizes="100vw"
              className="object-contain"
            />
          </div>
          {photos.length > 1 && (
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => move(1)}
              className="absolute right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25 sm:right-6"
            >
              ›
            </button>
          )}
          <p className="absolute bottom-4 text-sm font-medium text-white/90">
            {currentIndex + 1} / {photos.length}
          </p>
        </div>
      )}
    </>
  );
}
