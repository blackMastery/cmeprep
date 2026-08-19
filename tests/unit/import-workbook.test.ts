import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

// Both modules under test are `server-only`, which throws outside a React
// Server Component. Nothing here reaches Next's runtime or the database.
vi.mock("server-only", () => ({}));

const { workbookToMatrix } = await import("@/lib/admin/import");

/** A real 1×1 PNG — exceljs writes the bytes through untouched. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");

const HEADERS = [
  "Specialty", "Subject", "Stem", "Explanation",
  "Option A", "Option B", "Option C", "Option D",
  "Option E", "Option F", "Option G", "Option H",
  "Correct", "Image",
];

/** A one-question sheet with a picture anchored over the Image cell of row 2. */
async function workbookWithAnchoredImage(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Questions");
  ws.addRow(HEADERS);
  ws.addRow(["General", "Medicine", "Stem one", "Explanation one", "A", "B", "", "", "", "", "", "", "A", ""]);

  const id = wb.addImage({
    buffer: PNG as unknown as ExcelJS.Image["buffer"],
    extension: "png",
  });
  // 0-based, as anchors are stored: column N, row 2.
  ws.addImage(id, { tl: { col: 13, row: 1 }, ext: { width: 80, height: 80 } });

  const written = await wb.xlsx.writeBuffer();
  return new Uint8Array(written as unknown as Uint8Array);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function rewriteZip(
  bytes: Uint8Array,
  edit: (zip: JSZip) => Promise<void>
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(bytes);
  await edit(zip);
  return toArrayBuffer(await zip.generateAsync({ type: "uint8array" }));
}

const DRAWING_PART = /^xl\/drawings\/drawing\d+\.xml$/;

describe("workbookToMatrix — drawings exceljs cannot model", () => {
  it("reads a workbook whose drawing uses a namespace prefix other than xdr:", async () => {
    const base = await workbookWithAnchoredImage();
    const buffer = await rewriteZip(base, async (zip) => {
      for (const path of Object.keys(zip.files)) {
        if (!DRAWING_PART.test(path)) continue;
        const xml = await zip.file(path)!.async("string");
        // Legal XML, and exactly what makes exceljs throw
        // "Cannot read properties of undefined (reading 'anchors')".
        zip.file(path, xml.replace(/xdr:/g, "d1:"));
      }
    });

    const result = await workbookToMatrix(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.matrix.rows[0].cells[2]).toBe("Stem one");
    // The picture survives the strip: it is read straight out of the zip.
    const image = result.images.get(2);
    expect(image?.ok).toBe(true);
    if (!image?.ok) return;
    expect(image.sha256).toBe(PNG_SHA);
    expect(image.contentType).toBe("image/png");
  });

  it("reads a workbook whose drawing relationship dangles", async () => {
    const base = await workbookWithAnchoredImage();
    const buffer = await rewriteZip(base, async (zip) => {
      for (const path of Object.keys(zip.files)) {
        if (DRAWING_PART.test(path)) zip.remove(path);
      }
    });

    const result = await workbookToMatrix(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matrix.rows[0].cells[2]).toBe("Stem one");
    // Nothing left to import — the bytes went with the drawing part.
    expect(result.images.size).toBe(0);
  });

  it("still reads an ordinary workbook through exceljs", async () => {
    const result = await workbookToMatrix(toArrayBuffer(await workbookWithAnchoredImage()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matrix.header[0]).toBe("Specialty");
    expect(result.images.get(2)?.ok).toBe(true);
  });

  it("rejects something that is not a workbook at all", async () => {
    const result = await workbookToMatrix(toArrayBuffer(new TextEncoder().encode("stem,answer\n1,A\n")));
    expect(result.ok).toBe(false);
  });
});
