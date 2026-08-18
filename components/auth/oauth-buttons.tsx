"use client";

import { useFormStatus } from "react-dom";
import { signInWithProvider } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import type { OAUTH_PROVIDERS } from "@/lib/validation";

type Provider = (typeof OAUTH_PROVIDERS)[number];

/**
 * Social sign-in buttons plus the "or" divider above them. Each provider is
 * its own form so useFormStatus scopes the pending state to the button that
 * was actually clicked — which is why this stays a list of forms rather than
 * one form with a provider argument, even at a single provider.
 */
export function OAuthButtons({ next }: { next?: string }) {
  return (
    <div className="space-y-5">
      <div
        aria-hidden="true"
        className="flex items-center gap-3 text-xs text-muted-foreground"
      >
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="space-y-3">
        <ProviderForm provider="google" next={next} label="Continue with Google">
          <GoogleIcon />
        </ProviderForm>
      </div>
    </div>
  );
}

function ProviderForm({
  provider,
  next,
  label,
  children,
}: {
  provider: Provider;
  next?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <form action={signInWithProvider}>
      <input type="hidden" name="provider" value={provider} />
      {next && <input type="hidden" name="next" value={next} />}
      <ProviderButton label={label}>{children}</ProviderButton>
    </form>
  );
}

function ProviderButton({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline-muted"
      size="lg"
      className="w-full"
      disabled={pending}
      aria-busy={pending}
    >
      {children}
      {pending ? "Redirecting…" : label}
    </Button>
  );
}

/* Inline brand marks — external images are blocked by the narrow
   next.config.ts allow-list, and a data: URI would bloat the bundle. */

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.29a7.21 7.21 0 0 1 0-4.58v-3.1H1.27a12 12 0 0 0 0 10.78l4.01-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.6 4.59 1.79l3.44-3.44A11.98 11.98 0 0 0 1.27 6.61l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}

