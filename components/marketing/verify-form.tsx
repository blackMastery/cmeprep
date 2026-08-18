"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { parseCertificateCode } from "@/lib/certificates-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Code lookup. Normalising here means a verifier who types the code in
 * lowercase, drops the hyphens, or reads an O as a zero still lands on the
 * right page rather than a false "not found".
 */
export function VerifyForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        const code = parseCertificateCode(value);
        if (!code) {
          setError("That doesn't look like a certificate ID.");
          return;
        }
        setError(null);
        router.push(`/verify/${code}`);
      }}
    >
      <Label htmlFor="verify-code">Certificate ID</Label>
      <div className="flex gap-2">
        <Input
          id="verify-code"
          value={value}
          placeholder="CME-7K2M9-QX4PD"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error ? "verify-code-error" : undefined}
        />
        <Button type="submit">
          <Search data-icon="inline-start" />
          Check
        </Button>
      </div>
      {error && (
        <p id="verify-code-error" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
