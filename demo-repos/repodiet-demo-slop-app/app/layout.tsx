import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Demo Slop App",
  description: "Intentional AI-code-bloat patterns for RepoDiet demo scanning",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
