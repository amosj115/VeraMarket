/**
 * Rewrite a Cloudinary upload URL so the CDN serves a width-capped,
 * auto-format, auto-quality derivative instead of the original upload.
 * Uploads are stored untransformed (up to ~4 MB / 3072px), so without this
 * every next/image optimizer miss re-downloads and re-encodes the full
 * original. next/image still resizes on top; this only shrinks its origin
 * fetch. Non-Cloudinary URLs (S3 driver, app-relative paths) are unchanged.
 */
export function cdnImage(url: string, maxWidth?: number): string {
  if (!url || !url.includes("res.cloudinary.com") || !url.includes("/upload/")) {
    return url;
  }
  if (url.includes("q_auto") || url.includes("/upload/f_auto")) {
    return url; // already transformed
  }
  const [base, rest] = url.split("/upload/", 2);
  const transform = ["f_auto", "q_auto", ...(maxWidth ? [`w_${maxWidth}`] : [])].join(",");
  return `${base}/upload/${transform}/${rest}`;
}
