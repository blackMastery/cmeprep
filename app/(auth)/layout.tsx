import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { EcgLine } from "@/components/brand/ecg-line";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center gap-3">
            <Logo size="lg" tagline="stacked" />
            <EcgLine className="h-4 w-24 text-primary/60" strokeWidth={2} />
          </div>
          {children}
        </div>
      </main>
      <footer className="pb-8 text-center text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          ← Back to cmeprep.me
        </Link>
      </footer>
    </div>
  );
}
