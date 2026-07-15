import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://skillswap-virid-kappa.vercel.app"),
  title: "RepoDiet — A2MCP Quick Triage + A2A Verified Cleanup PR",
  description:
    "OKX.AI ASP 5283. A2MCP Quick Triage (32948) is 0.03 USD₮0 pay-per-call via x402. A2A Verified Cleanup PR (32947) is negotiated escrow delivery with default reference 1 USD₮0.",
  openGraph: {
    title: "RepoDiet — A2MCP Quick Triage + A2A Verified Cleanup PR",
    description:
      "Standardized A2MCP Quick Triage through x402. Customized A2A cleanup PR delivery through negotiated escrow and buyer acceptance.",
    url: "https://skillswap-virid-kappa.vercel.app",
    siteName: "RepoDiet",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "RepoDiet — A2MCP Quick Triage + A2A Verified Cleanup PR",
    description:
      "A2MCP 32948 at 0.03 USD₮0 via x402. A2A 32947 negotiated cleanup PR (default 1 USD₮0).",
  },
  icons: {
    icon: [
      { url: "/brand/repodiet-mark-64.png", sizes: "64x64", type: "image/png" },
      { url: "/brand/repodiet-mark-128.png", sizes: "128x128", type: "image/png" },
    ],
    apple: "/brand/repodiet-mark-256.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
