import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Deno Edge Function entrypoints: npm:/jsr: specifiers and Deno globals
    // that Node's resolver and typescript-eslint can't see. The shared pure
    // core next to them (supabase/functions/_shared) stays linted — the app
    // imports it.
    "supabase/functions/*/index.ts",
  ]),
]);

export default eslintConfig;
