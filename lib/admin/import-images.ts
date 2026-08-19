import "server-only";

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Workbook, Worksheet } from "exceljs";
import {
  columnOfCellRef,
  mapAnchoredImages,
  mapInCellImages,
  resolveDrawingPath,
  resolveSheetPath,
  rowOfCellRef,
  sniffImageType,
  type AnchoredImageRef,
  type SniffedImageType,
} from "@/lib/admin/import-images-core";
import { MAX_IMAGE_BYTES } from "@/lib/storage";

/**
 * Getting picture bytes out of an uploaded workbook.
 *
 * Excel offers two unrelated ways to put an image "in a column", and an admin
 * cannot tell them apart by looking:
 *
 *   Insert ▸ Pictures ▸ Place over Cells  → a drawing anchored to a cell,
 *     which exceljs models as worksheet.getImages()
 *   Insert ▸ Pictures ▸ Place in Cell     → a rich value, which exceljs does
 *     not model at all, so it is read from the zip by hand
 *
 * Both are supported. A third form — an https:// URL typed into the cell — is
 * ordinary cell text, so import-core handles the validation and only the
 * fetch lands here (at commit, never at preview).
 */

export type EmbeddedImage =
  | {
      ok: true;
      bytes: Uint8Array;
      contentType: SniffedImageType;
      sha256: string;
      byteLength: number;
    }
  | { ok: false; message: string };

export type ExtractedImages = {
  /** Spreadsheet row number → the picture sitting in that row's Image cell. */
  byRow: Map<number, EmbeddedImage>;
  /** File-level notes: pictures that could not be attributed to a data row. */
  warnings: string[];
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Shared by both readers: sniff, size-check, hash. */
function describe(bytes: Uint8Array): EmbeddedImage {
  if (bytes.byteLength === 0) {
    return { ok: false, message: "the picture in this row is empty." };
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    const mb = (bytes.byteLength / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      message: `the picture in this row is ${mb} MB — images must be 5 MB or smaller. Resize it and re-insert it.`,
    };
  }
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return {
      ok: false,
      message:
        "the picture in this row is not a PNG, JPEG or WebP. Convert it and re-insert it.",
    };
  }
  return {
    ok: true,
    bytes,
    contentType,
    sha256: sha256Hex(bytes),
    byteLength: bytes.byteLength,
  };
}

/**
 * Collect every picture that belongs to the Image column.
 *
 * `imageColumn` is 1-based to match exceljs. Null means the sheet has no
 * Image header at all, in which case any picture present is reported as a
 * file-level warning rather than silently dropped — a sheet full of diagrams
 * that imports zero images should say so.
 */
export async function extractRowImages(
  buffer: ArrayBuffer,
  workbook: Workbook,
  worksheet: Worksheet,
  imageColumn: number | null
): Promise<ExtractedImages> {
  const byRow = new Map<number, EmbeddedImage>();
  const warnings: string[] = [];

  let outsideColumn = 0;
  let duplicateRows = 0;

  const place = (rowNumber: number, column: number, image: EmbeddedImage) => {
    if (imageColumn === null || column !== imageColumn) {
      outsideColumn += 1;
      return;
    }
    if (byRow.has(rowNumber)) {
      duplicateRows += 1;
      return;
    }
    byRow.set(rowNumber, image);
  };

  // ── Place over Cells ──────────────────────────────────────
  // Anchors are 0-based in both axes; exceljs is 1-based everywhere else.
  const anchored =
    typeof worksheet.getImages === "function" ? (worksheet.getImages() ?? []) : [];
  for (const anchor of anchored) {
    const media = workbook.getImage(Number(anchor.imageId));
    // exceljs declares `Buffer extends ArrayBuffer` in its own .d.ts, so the
    // static type says nothing useful; at runtime this is a Node Buffer.
    // `new Uint8Array()` copes with either.
    const raw = media?.buffer as unknown as ArrayBuffer | Uint8Array | undefined;
    if (!raw) continue;
    place(
      anchor.range.tl.nativeRow + 1,
      anchor.range.tl.nativeCol + 1,
      describe(new Uint8Array(raw))
    );
  }

  // exceljs models a drawing only when it is written exactly the way Excel
  // writes it; other generators produce parts it refuses to parse, and
  // workbookToMatrix strips those so the cell values still load. Either way
  // getImages() comes back empty, so read the anchors out of the zip instead.
  if (anchored.length === 0) {
    try {
      for (const [ref, bytes] of await readAnchoredImages(buffer, worksheet.name)) {
        place(ref.row, ref.column, describe(bytes));
      }
    } catch (error) {
      // Same reasoning as the in-cell reader below: never fail an import over
      // pictures. The counts above still tell the admin what was ignored.
      console.error("anchored_image_read_failed", error);
    }
  }

  // ── Place in Cell ─────────────────────────────────────────
  try {
    const inCell = await readInCellImages(buffer, worksheet.name);
    for (const [ref, bytes] of inCell) {
      const rowNumber = rowOfCellRef(ref);
      const column = columnOfCellRef(ref);
      if (rowNumber === null || column === null) continue;
      place(rowNumber, column, describe(bytes));
    }
  } catch (error) {
    // A workbook with no rich data at all is the common case and throws
    // nothing; this is for a malformed one. Never fail the whole import over
    // it — anchored pictures and URLs still work.
    console.error("in_cell_image_read_failed", error);
    warnings.push(
      "This sheet uses Excel's newer in-cell pictures and they could not be read. Re-insert them with Insert ▸ Pictures ▸ Place over Cells, or paste an image URL instead."
    );
  }

  if (outsideColumn > 0) {
    warnings.push(
      imageColumn === null
        ? `${outsideColumn} picture${outsideColumn === 1 ? "" : "s"} found, but this sheet has no "Image" column — add one and put each picture in it.`
        : `${outsideColumn} picture${outsideColumn === 1 ? "" : "s"} sit outside the Image column and were ignored.`
    );
  }
  if (duplicateRows > 0) {
    warnings.push(
      `${duplicateRows} row${duplicateRows === 1 ? " has" : "s have"} more than one picture — only the first was used.`
    );
  }

  return { byRow, warnings };
}

/**
 * Walk the rich-value chain and pull the referenced media out of the zip.
 *
 * Reads the ORIGINAL upload rather than anything exceljs produced: exceljs
 * neither models these parts nor round-trips them.
 */
async function readInCellImages(
  buffer: ArrayBuffer,
  sheetName: string
): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>();

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const read = async (path: string): Promise<string | null> => {
    const entry = zip.file(path);
    return entry ? entry.async("string") : null;
  };

  // Cheapest possible bail-out: no rich data, nothing to do.
  const rdRichValueXml = await read("xl/richData/rdrichvalue.xml");
  const richValueRelXml = await read("xl/richData/richValueRel.xml");
  const relsXml = await read("xl/richData/_rels/richValueRel.xml.rels");
  const metadataXml = await read("xl/metadata.xml");
  if (!rdRichValueXml || !richValueRelXml || !relsXml || !metadataXml) return result;

  const workbookXml = await read("xl/workbook.xml");
  const workbookRelsXml = await read("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !workbookRelsXml) return result;

  const sheetPath = resolveSheetPath(workbookXml, workbookRelsXml, sheetName);
  if (!sheetPath) return result;

  const sheetXml = await read(sheetPath);
  if (!sheetXml) return result;

  const mapped = mapInCellImages({
    sheetXml,
    metadataXml,
    rdRichValueXml,
    structureXml: (await read("xl/richData/rdrichvaluestructure.xml")) ?? undefined,
    richValueRelXml,
    relsXml,
  });

  for (const [ref, mediaPath] of mapped) {
    const entry = zip.file(mediaPath);
    if (!entry) continue;
    result.set(ref, await entry.async("uint8array"));
  }

  return result;
}

/**
 * Read "Place over Cells" pictures straight out of the zip.
 *
 * The fallback for workbooks exceljs cannot model: sheet → drawing rel →
 * drawing part → media, all from the ORIGINAL upload, so it works whether or
 * not the drawings survived into the loaded workbook.
 */
async function readAnchoredImages(
  buffer: ArrayBuffer,
  sheetName: string
): Promise<[AnchoredImageRef, Uint8Array][]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const read = async (path: string): Promise<string | null> => {
    const entry = zip.file(path);
    return entry ? entry.async("string") : null;
  };

  const workbookXml = await read("xl/workbook.xml");
  const workbookRelsXml = await read("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !workbookRelsXml) return [];

  const sheetPath = resolveSheetPath(workbookXml, workbookRelsXml, sheetName);
  if (!sheetPath) return [];

  const sheetXml = await read(sheetPath);
  const sheetRelsXml = await read(relsPathFor(sheetPath));
  if (!sheetXml || !sheetRelsXml) return [];

  const drawingPath = resolveDrawingPath(sheetPath, sheetXml, sheetRelsXml);
  if (!drawingPath) return [];

  const drawingXml = await read(drawingPath);
  const drawingRelsXml = await read(relsPathFor(drawingPath));
  if (!drawingXml || !drawingRelsXml) return [];

  const found: [AnchoredImageRef, Uint8Array][] = [];
  for (const ref of mapAnchoredImages(drawingPath, drawingXml, drawingRelsXml)) {
    const entry = zip.file(ref.mediaPath);
    if (!entry) continue;
    found.push([ref, await entry.async("uint8array")]);
  }
  return found;
}

/** "xl/worksheets/sheet1.xml" → "xl/worksheets/_rels/sheet1.xml.rels". */
function relsPathFor(path: string): string {
  const cut = path.lastIndexOf("/");
  return `${path.slice(0, cut + 1)}_rels/${path.slice(cut + 1)}.rels`;
}

// ── URL images ──────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 1;

/**
 * Download an image an admin referenced by URL.
 *
 * Runs only at commit, so a preview never makes the server hit an
 * admin-supplied address. Guards are SSRF basics: https only, no
 * private/loopback/link-local destinations, one redirect, a hard timeout, and
 * a byte ceiling enforced while streaming (Content-Length is a hint, not a
 * promise).
 *
 * The DNS pre-check is racy by construction — the fetch resolves the name
 * again — but this endpoint is admin-only, so it is a guard rail against
 * mistakes and copied-in internal links, not a defence against the caller.
 */
export async function fetchImageFromUrl(url: string): Promise<EmbeddedImage> {
  let current: string;
  try {
    current = new URL(url).toString();
  } catch {
    return { ok: false, message: `the image URL "${url}" is not a valid URL.` };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:") {
      return { ok: false, message: "image URLs must start with https://." };
    }

    const blocked = await hostIsBlocked(parsed.hostname);
    if (blocked) {
      return {
        ok: false,
        message: `the image URL points at ${blocked}, which the server will not fetch. Use a publicly reachable URL.`,
      };
    }

    let response: Response;
    try {
      response = await fetch(parsed, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "image/png,image/jpeg,image/webp" },
      });
    } catch {
      return {
        ok: false,
        message: `the image at ${parsed.hostname} could not be downloaded (timed out or unreachable).`,
      };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || hop === MAX_REDIRECTS) {
        return { ok: false, message: "the image URL redirects too many times." };
      }
      current = new URL(location, parsed).toString();
      continue;
    }

    if (!response.ok || !response.body) {
      return {
        ok: false,
        message: `the image URL returned HTTP ${response.status}.`,
      };
    }

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        message: "the image at that URL is larger than 5 MB.",
      };
    }

    const bytes = await readCapped(response.body);
    if (!bytes) {
      return { ok: false, message: "the image at that URL is larger than 5 MB." };
    }
    return describe(bytes);
  }

  return { ok: false, message: "the image URL redirects too many times." };
}

/** Drain a body, giving up the moment it exceeds the image ceiling. */
async function readCapped(
  body: ReadableStream<Uint8Array>
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Human-readable reason a host is off limits, or null when it is fine. */
async function hostIsBlocked(hostname: string): Promise<string | null> {
  // URL.hostname keeps the brackets on an IPv6 literal ("[::1]"), which isIP
  // does not recognise — without stripping them every v6 address would skip
  // the literal check and fall through to a pointless DNS lookup.
  const host = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  if (isIP(host) !== 0) {
    return isPrivateAddress(host) ? "a private network address" : null;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return "a hostname that does not resolve";
  }

  if (addresses.length === 0) return "a hostname that does not resolve";
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    return "a private network address";
  }
  return null;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    // IPv4-mapped (::ffff:10.0.0.1) hides a v4 address inside a v6 literal.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (lower === "::" || lower === "::1") return true;
    // Unique-local fc00::/7 and link-local fe80::/10.
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }

  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return true;
  const [a, b] = parts;

  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && b >= 18 && b <= 19) || // benchmarking
    a >= 224 // multicast and reserved
  );
}
