import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "RepoDiet — Cut AI code bloat before your app collapses",
  description:
    "Scan AI-built JavaScript and TypeScript repos for duplicate code, dead files, unused dependencies, and generate safe cleanup patches.",
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
