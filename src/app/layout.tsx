import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { ConnectivityBanner } from "@/components/pwa/connectivity-banner";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import { THEME_COLORS, THEME_INIT_SCRIPT } from "@/lib/theme/theme";

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

const utility = IBM_Plex_Mono({
  variable: "--font-utility",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  applicationName: "Budget App",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Budget App",
  },
  description:
    "A self-hosted, read-only family budgeting app for Canadian households.",
  // Declaring `icons` at all makes Next drop every file-convention icon it
  // would otherwise have emitted (`accumulateMetadata` only applies them when
  // `resolvedMetadata.icons` is unset), so `app/icon.svg` and `app/favicon.ico`
  // have to be listed here explicitly or they silently stop being linked.
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "256x256", type: "image/x-icon" },
    ],
    apple: [{ url: "/icons/apple-touch-icon-180.png", sizes: "180x180" }],
  },
  title: {
    default: "Budget App",
    template: "%s · Budget App",
  },
};

export const viewport: Viewport = {
  // `cover` is what makes every env(safe-area-inset-*) in globals.css resolve
  // to a real value on a notched or gesture-bar device.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // userScalable is left at its default so pinch-zoom stays available.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${utility.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs while the HTML is still parsing, so a stored Light/Dark choice
            is applied before the first paint instead of flashing the other
            palette. suppressHydrationWarning above lets React keep the
            attribute this sets. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        {/* Targets the `<main>` landmark each route renders, not a wrapper
            around everything: inside the application shell a wrapper would sit
            above the navigation rail, so "skip" would land the member right
            back at the links the skip link exists to bypass. */}
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <ConnectivityBanner />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
