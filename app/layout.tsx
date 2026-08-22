import type { Metadata, Viewport } from "next";
import { Geist_Mono, Poppins, Public_Sans } from "next/font/google";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from "@/lib/site";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

// Brand typeface — carries the wordmark, headings and question stems. The
// wordmark relies on the weight contrast between a bold "cmeprep" and a
// light ".me", so both ends of the range are loaded.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE_DEFAULT = `${SITE_NAME} — ${SITE_TAGLINE}`;

export const metadata: Metadata = {
  // Everything below (canonicals, OG images, sitemap refs) resolves against
  // this. Without it, relative image paths are a build error and canonicals
  // are omitted entirely.
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE_DEFAULT,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "CME question bank",
    "medical question bank",
    "medical board exam practice questions",
    "USMLE question bank",
    "PLAB practice questions",
    "NCLEX practice questions",
    "CAMC exam prep",
    "MBBS exit exam",
    "OSCE stations",
    "timed mock exams",
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: "/",
    title: TITLE_DEFAULT,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE_DEFAULT,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Let Google use full-size thumbnails and untruncated snippets rather
      // than its conservative defaults.
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  manifest: "/site.webmanifest",
  icons: {
    // app/favicon.ico is emitted by file convention (`sizes="any"`). These
    // cover what it cannot: crisp hi-dpi PNGs, and the iOS home-screen icon,
    // which has no .ico fallback at all.
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  // Stops iOS Safari turning stray numbers (question counts, prices) into
  // tap-to-call links.
  formatDetection: { telephone: false },
};

/**
 * Browser chrome colour. These track the page background per theme rather
 * than the brand coral — the address bar sits directly above the page, so a
 * contrasting bar reads as a rendering seam.
 */
export const viewport: Viewport = {
  // Lets env(safe-area-inset-*) resolve on notched phones, so pinned footers
  // can pad themselves clear of the home indicator.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1815" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${poppins.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
