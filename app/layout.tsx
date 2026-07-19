import type { Metadata } from "next";
import { Geist_Mono, Poppins, Public_Sans } from "next/font/google";
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

export const metadata: Metadata = {
  title: {
    default: "cmeprep.me — Pass your Medical Board and Exit Examinations",
    template: "%s · cmeprep.me",
  },
  description:
    "Practice questions and timed mock exams for medical board and exit examinations. Unlimited questions across 7 question banks plus an OSCE station bank — CAMC, USMLE, PLAB, NCLEX, MBBS and MCDN.",
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
