import type { ReactNode } from "react";

export const metadata = {
  title: "RepoDiet E2E Test",
  description: "Controlled cleanup scenarios for RepoDiet verification",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
