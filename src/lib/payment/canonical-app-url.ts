/** Canonical public HTTPS origin for x402 resource URLs and receipts. */
export function canonicalAppOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL?.replace(/\/$/, "");
  if (vercel) return vercel.startsWith("http") ? vercel : `https://${vercel}`;
  return "";
}

export function canonicalResourceUrl(pathname: string, requestUrl?: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const origin = canonicalAppOrigin();
  if (origin) return `${origin}${path}`;
  if (requestUrl) return new URL(requestUrl).toString();
  return path;
}
