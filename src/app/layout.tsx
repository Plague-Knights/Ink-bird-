import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";

// Render on every request so deploy changes promote immediately.
// Railway's Fastly edge was caching the prerendered root for a year
// (s-maxage=31536000), which meant the / → /cannon redirect never
// reached visitors holding the stale HTML.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ink Squid",
  description: "Swim through the reef. Collect ink droplets. Submit on Ink chain.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout draw under the iOS notch / home-indicator; globals.css
  // uses env(safe-area-inset-*) on <body> to put content back inside.
  viewportFit: "cover",
  themeColor: "#020716",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700;900&display=swap"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
