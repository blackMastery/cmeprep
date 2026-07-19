const HONORIFICS = new Set([
  "dr",
  "dr.",
  "doctor",
  "prof",
  "prof.",
  "professor",
  "mr",
  "mr.",
  "mrs",
  "mrs.",
  "ms",
  "ms.",
  "miss",
]);

/**
 * First name for greetings. Skips leading honorifics so "Dr. Anita Persaud"
 * greets "Anita" rather than "Dr.".
 */
export function firstName(fullName: string | null | undefined): string | null {
  if (!fullName) return null;

  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const name = parts.find((part) => !HONORIFICS.has(part.toLowerCase()));

  return name ?? null;
}
