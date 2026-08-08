/**
 * Pure half of the importer's image support.
 *
 * Same split as import-core.ts / import.ts: no exceljs, no jszip, no
 * `server-only`, so Vitest can cover the fiddly parts — magic-byte sniffing
 * and Excel's in-cell-image indirection chain — without building a workbook.
 * lib/admin/import-images.ts is the side-effecting half.
 */

import { ALLOWED_IMAGE_TYPES } from "@/lib/storage";

export type SniffedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/**
 * Identify an image by its leading bytes.
 *
 * Never trust the file extension here. exceljs derives `Image.extension` from
 * the zip entry name and types it `'jpeg' | 'png' | 'gif'`, so it can neither
 * be relied on nor even express WebP — and the bucket's allowed_mime_types is
 * enforced by Storage, so a wrong guess fails at upload with an opaque error
 * instead of a row message the admin can act on.
 *
 * Returns null for anything outside the bucket's allowlist (GIF, BMP, SVG,
 * TIFF, or a file that is not an image at all).
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (bytes.length >= 8) {
    // \x89 P N G \r \n \x1a \n
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return "image/png";
    }
  }

  // SOI + the first marker byte. Covers JFIF, Exif and bare JPEG alike.
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // RIFF....WEBP — the four size bytes at 4..7 are skipped deliberately.
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

// ── Cell reference helpers ──────────────────────────────────

/** "N12" → 12. Null when the reference is not a plain cell address. */
export function rowOfCellRef(ref: string): number | null {
  const match = /^[A-Z]+(\d+)$/.exec(ref.toUpperCase());
  return match ? Number(match[1]) : null;
}

/** "N12" → 13 (1-based column index, matching exceljs). */
export function columnOfCellRef(ref: string): number | null {
  const match = /^([A-Z]+)\d+$/.exec(ref.toUpperCase());
  if (!match) return null;
  let index = 0;
  for (const char of match[1]) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index;
}

// ── Worksheet part lookup ───────────────────────────────────

/**
 * Locate a sheet's XML part, e.g. "xl/worksheets/sheet3.xml".
 *
 * The in-cell-image chain starts from the raw sheet XML, and sheet part names
 * do not follow tab order — a workbook whose second tab is sheet1.xml is
 * perfectly legal, so the r:id indirection has to be walked properly.
 */
export function resolveSheetPath(
  workbookXml: string,
  workbookRelsXml: string,
  sheetName: string
): string | null {
  const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)]
    .map((m) => m[0])
    .find((tag) => {
      const name = /\bname="([^"]*)"/.exec(tag)?.[1];
      return name !== undefined && decodeXmlEntities(name) === sheetName;
    });
  if (!sheetTag) return null;

  const relId = /\br:id="([^"]*)"/.exec(sheetTag)?.[1];
  if (!relId) return null;

  const target = relationshipTargets(workbookRelsXml).get(relId);
  if (!target) return null;

  // Targets in xl/_rels/workbook.xml.rels are relative to xl/.
  return resolveRelativePath("xl/", target);
}

// ── In-cell images (Excel 365 "Place in Cell") ──────────────

export type RichDataParts = {
  /** The worksheet part, e.g. xl/worksheets/sheet1.xml. */
  sheetXml: string;
  /** xl/metadata.xml */
  metadataXml: string;
  /** xl/richData/rdrichvalue.xml */
  rdRichValueXml: string;
  /** xl/richData/rdrichvaluestructure.xml — optional but preferred. */
  structureXml?: string;
  /** xl/richData/richValueRel.xml */
  richValueRelXml: string;
  /** xl/richData/_rels/richValueRel.xml.rels */
  relsXml: string;
};

/**
 * Map cell references to the media part each in-cell image lives in.
 *
 * Excel stores a "Place in Cell" picture as an error cell carrying a `vm`
 * (value-metadata) attribute, and then makes you walk five parts to find the
 * bytes:
 *
 *   <c r="N2" t="e" vm="1">            vm is a 1-based valueMetadata index
 *     → xl/metadata.xml  <bk><rc t=".." v="0"/></bk>
 *         v indexes the futureMetadata blocks of the XLRICHVALUE type
 *     → <futureMetadata name="XLRICHVALUE"> … <xlrd:rvb i="0"/>
 *         i is the rich value index
 *     → xl/richData/rdrichvalue.xml  <rv s="0"><v>0</v>…</rv>
 *         one <v> holds the richValueRel index (which one comes from the
 *         structure part; position 0 in every file Excel writes)
 *     → xl/richData/richValueRel.xml  <rel r:id="rId1"/>
 *     → xl/richData/_rels/richValueRel.xml.rels  rId1 → ../media/image1.png
 *
 * Every hop degrades to the identity mapping if its part is missing or
 * unparseable, which is what Excel's own files happen to use — so a partial
 * read still returns the right image rather than nothing.
 */
export function mapInCellImages(parts: RichDataParts): Map<string, string> {
  const result = new Map<string, string>();

  const relTargets = relationshipTargets(parts.relsXml);
  if (relTargets.size === 0) return result;

  // richValueRel index → media part path.
  const mediaByRelIndex: string[] = [];
  for (const tag of parts.richValueRelXml.matchAll(/<rel\b[^>]*\/?>/g)) {
    const relId = /\br:id="([^"]*)"/.exec(tag[0])?.[1];
    const target = relId ? relTargets.get(relId) : undefined;
    // Targets here are relative to xl/richData/.
    mediaByRelIndex.push(target ? resolveRelativePath("xl/richData/", target) : "");
  }
  if (mediaByRelIndex.length === 0) return result;

  const relIndexPosition = localImageValuePosition(parts.structureXml);

  // Rich value index → richValueRel index.
  const relIndexByRichValue: number[] = [];
  for (const rv of parts.rdRichValueXml.matchAll(/<rv\b[^>]*>([\s\S]*?)<\/rv>/g)) {
    const values = [...rv[1].matchAll(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/g)].map((m) =>
      m[1].trim()
    );
    // A structure may declare the identifier at a position this particular
    // rich value does not fill; fall back to the first numeric value.
    const raw =
      values[relIndexPosition] ?? values.find((v) => /^\d+$/.test(v)) ?? "";
    relIndexByRichValue.push(/^\d+$/.test(raw) ? Number(raw) : -1);
  }

  const richValueByValueMetadata = valueMetadataToRichValue(parts.metadataXml);

  for (const tag of parts.sheetXml.matchAll(/<c\b[^>]*\/?>/g)) {
    const ref = /\br="([^"]*)"/.exec(tag[0])?.[1];
    const vm = /\bvm="(\d+)"/.exec(tag[0])?.[1];
    if (!ref || !vm) continue;

    // vm is 1-based into valueMetadata.
    const richValueIndex = richValueByValueMetadata[Number(vm) - 1];
    if (richValueIndex === undefined || richValueIndex < 0) continue;

    const relIndex = relIndexByRichValue[richValueIndex];
    if (relIndex === undefined || relIndex < 0) continue;

    const media = mediaByRelIndex[relIndex];
    if (media) result.set(ref.toUpperCase(), media);
  }

  return result;
}

/**
 * Which `<v>` inside an `<rv>` holds the richValueRel index.
 *
 * Excel names the key `_rvRel:LocalImageIdentifier` in
 * rdrichvaluestructure.xml and always writes it first, but a structure with
 * extra keys (CalcOrigin, Text) would shift it — so read the declared order
 * when the part is available.
 */
function localImageValuePosition(structureXml: string | undefined): number {
  if (!structureXml) return 0;
  const keys = [...structureXml.matchAll(/<k\b[^>]*\bn="([^"]*)"[^>]*\/?>/g)].map(
    (m) => m[1]
  );
  const index = keys.findIndex((name) => /LocalImageIdentifier/i.test(name));
  return index >= 0 ? index : 0;
}

/**
 * valueMetadata block index (0-based) → rich value index.
 *
 * `<rc t="N" v="M"/>` — t is a 1-based index into `<metadataTypes>` and only
 * XLRICHVALUE entries carry images; v indexes that type's futureMetadata
 * blocks, each of which holds the real rich value index in `<rvb i="…"/>`.
 */
function valueMetadataToRichValue(metadataXml: string): number[] {
  const typeNames = [...metadataXml.matchAll(/<metadataType\b[^>]*\bname="([^"]*)"/g)].map(
    (m) => m[1]
  );
  // 1-based, per the `t` attribute.
  const richValueTypeIndex = typeNames.findIndex((n) => n === "XLRICHVALUE") + 1;

  const futureBlock = /<futureMetadata\b[^>]*\bname="XLRICHVALUE"[^>]*>([\s\S]*?)<\/futureMetadata>/.exec(
    metadataXml
  );
  const richValueByFutureIndex = futureBlock
    ? [...futureBlock[1].matchAll(/<bk\b[^>]*>([\s\S]*?)<\/bk>/g)].map((bk) => {
        const i = /<[\w]*:?rvb\b[^>]*\bi="(\d+)"/.exec(bk[1])?.[1];
        return i === undefined ? -1 : Number(i);
      })
    : [];

  const valueBlock = /<valueMetadata\b[^>]*>([\s\S]*?)<\/valueMetadata>/.exec(metadataXml);
  if (!valueBlock) return [];

  return [...valueBlock[1].matchAll(/<bk\b[^>]*>([\s\S]*?)<\/bk>/g)].map((bk) => {
    const rc = /<rc\b[^>]*\/?>/.exec(bk[1])?.[0];
    if (!rc) return -1;

    const t = /\bt="(\d+)"/.exec(rc)?.[1];
    // Other metadata types (dynamic arrays, for instance) share this list.
    if (richValueTypeIndex > 0 && t !== undefined && Number(t) !== richValueTypeIndex) {
      return -1;
    }

    const v = /\bv="(\d+)"/.exec(rc)?.[1];
    if (v === undefined) return -1;

    const futureIndex = Number(v);
    const mapped = richValueByFutureIndex[futureIndex];
    // No futureMetadata (or a gap in it) → v is already the rich value index,
    // which is how every file Excel writes happens to be laid out anyway.
    return mapped === undefined || mapped < 0 ? futureIndex : mapped;
  });
}

// ── Shared XML helpers ──────────────────────────────────────

/** Relationship Id → Target, from any *.rels part. */
function relationshipTargets(relsXml: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const tag of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = /\bId="([^"]*)"/.exec(tag[0])?.[1];
    const target = /\bTarget="([^"]*)"/.exec(tag[0])?.[1];
    if (id && target) map.set(id, decodeXmlEntities(target));
  }
  return map;
}

/**
 * Resolve a relationship target against the directory holding its part,
 * collapsing the `../` that Excel writes. Absolute targets ("/xl/media/…")
 * are returned zip-rooted.
 */
function resolveRelativePath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);

  const segments = `${baseDir}${target}`.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
