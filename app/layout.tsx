import type { Metadata } from "next";
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
    "medical board exam practice questions",
    "USMLE question bank",
    "PLAB practice questions",
    "NCLEX practice questions",
    "CAMC exam prep",
    "MBBS exit exam",
    "MDCN exam",
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
  icons: {
    // favicon.ico + app/icon.tsx are picked up by file convention; apple
    // touch icons have no .ico fallback, so the logo is named explicitly.
    apple: "/logo.jpg",
  },
  // Stops iOS Safari turning stray numbers (question counts, prices) into
  // tap-to-call links.
  formatDetection: { telephone: false },
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
