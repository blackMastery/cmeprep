import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The module under test is `server-only`, which throws outside a React Server
// Component. Nothing here touches Next's runtime, so stub the marker away.
vi.mock("server-only", () => ({}));

const { extractRowImages, fetchImageFromUrl, sha256Hex } = await import(
  "@/lib/admin/import-images"
);

// ── Fixtures ────────────────────────────────────────────────

/** A real 1×1 PNG — exceljs writes the bytes through untouched. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
/** A real 1×1 GIF — a valid image the bucket does not accept. */
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const HEADERS = [
  "Specialty", "Subject", "Stem", "Explanation",
  "Option A", "Option B", "Option C", "Option D",
  "Option E", "Option F", "Option G", "Option H",
  "Correct", "Image",
];
/** 1-based index of the Image column, as exceljs counts. */
const IMAGE_COL = 14;

type Placement = { buffer: Buffer; extension: "png" | "gif"; col: number; row: number };

/**
 * Build a real .xlsx with pictures anchored over cells — the
 * "Insert ▸ Pictures ▸ Place over Cells" form. `col`/`row` are 0-based, which
 * is how drawing anchors are stored.
 */
async function workbookWith(placements: Placement[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Questions");
  ws.addRow(HEADERS);
  ws.addRow(["General", "Medicine", "Stem one", "Explanation one", "A", "B", "", "", "", "", "", "", "A", ""]);
  ws.addRow(["General", "Medicine", "Stem two", "Explanation two", "A", "B", "", "", "", "", "", "", "A", ""]);

  for (const p of placements) {
    // exceljs declares its own `Buffer extends ArrayBuffer`, which does not
    // line up with Node's — it takes a real Buffer at runtime regardless.
    const id = wb.addImage({
      buffer: p.buffer as unknown as ExcelJS.Image["buffer"],
      extension: p.extension,
    });
    ws.addImage(id, { tl: { col: p.col, row: p.row }, ext: { width: 80, height: 80 } });
  }

  const written = await wb.xlsx.writeBuffer();
  const bytes = new Uint8Array(written as unknown as Uint8Array);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  // Read it back the way the importer does, rather than reusing the in-memory
  // workbook — that is the path a real upload takes.
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  return { buffer, workbook: loaded, worksheet: loaded.getWorksheet("Questions")! };
}

/**
 * Build a workbook with an "Insert ▸ Pictures ▸ Place in Cell" picture.
 *
 * exceljs cannot write these, so the rich-data parts are grafted on with
 * JSZip exactly as Excel lays them out: the cell becomes an error cell
 * carrying a `vm` pointer, and the bytes hang off a five-part chain.
 */
async function workbookWithInCellImage() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Questions");
  ws.addRow(HEADERS);
  ws.addRow(["General", "Medicine", "Stem one", "Explanation one", "A", "B", "", "", "", "", "", "", "A", ""]);
  ws.addRow(["General", "Medicine", "Stem two", "Explanation two", "A", "B", "", "", "", "", "", "", "A", ""]);

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());

  zip.file("xl/media/image1.png", PNG);

  const sheetPath = "xl/worksheets/sheet1.xml";
  const sheet = (await zip.file(sheetPath)!.async("string")).replace(
    /(<row r="2"[^>]*>)([\s\S]*?)(<\/row>)/,
    '$1$2<c r="N2" t="e" vm="1"><v>#VALUE!</v></c>$3'
  );
  zip.file(sheetPath, sheet);

  zip.file(
    "xl/metadata.xml",
    `<metadata><metadataTypes count="1"><metadataType name="XLRICHVALUE"/></metadataTypes>` +
      `<futureMetadata name="XLRICHVALUE" count="1"><bk><extLst><ext uri="{3e2802c4}"><xlrd:rvb i="0"/></ext></extLst></bk></futureMetadata>` +
      `<valueMetadata count="1"><bk><rc t="1" v="0"/></bk></valueMetadata></metadata>`
  );
  zip.file("xl/richData/rdrichvalue.xml", `<rvData count="1"><rv s="0"><v>0</v><v>5</v></rv></rvData>`);
  zip.file(
    "xl/richData/rdrichvaluestructure.xml",
    `<rvStructures count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>`
  );
  zip.file("xl/richData/richValueRel.xml", `<richValueRels><rel r:id="rId1"/></richValueRels>`);
  zip.file(
    "xl/richData/_rels/richValueRel.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://x/image" Target="../media/image1.png"/></Relationships>`
  );

  const out = await zip.generateAsync({ type: "uint8array" });
  const buffer = new ArrayBuffer(out.byteLength);
  new Uint8Array(buffer).set(out);

  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  return { buffer, workbook: loaded, worksheet: loaded.getWorksheet("Questions")! };
}

describe("extractRowImages — pictures placed in cells", () => {
  it("pulls the bytes out of the rich-data chain", async () => {
    const { buffer, workbook, worksheet } = await workbookWithInCellImage();

    const { byRow, warnings } = await extractRowImages(buffer, workbook, worksheet, IMAGE_COL);

    expect(warnings).toEqual([]);
    expect([...byRow.keys()]).toEqual([2]);
    const image = byRow.get(2)!;
    expect(image.ok).toBe(true);
    if (!image.ok) return;
    expect(image.contentType).toBe("image/png");
    expect(image.sha256).toBe(createHash("sha256").update(PNG).digest("hex"));
  });

  it("attributes it to the Image column, so a mismatched column warns", async () => {
    const { buffer, workbook, worksheet } = await workbookWithInCellImage();
    const { byRow, warnings } = await extractRowImages(buffer, workbook, worksheet, 3);
    expect(byRow.size).toBe(0);
    expect(warnings[0]).toMatch(/outside the Image column/);
  });
});

// ── Anchored pictures ───────────────────────────────────────

describe("extractRowImages — pictures placed over cells", () => {
  it("finds a picture in the Image column and describes it", async () => {
    const { buffer, workbook, worksheet } = await workbookWith([
      { buffer: PNG, extension: "png", col: IMAGE_COL - 1, row: 1 },
    ]);

    const { byRow, warnings } = await extractRowImages(buffer, workbook, worksheet, IMAGE_COL);

    expect(warnings).toEqual([]);
    expect([...byRow.keys()]).toEqual([2]); // 0-based anchor row 1 → sheet row 2
    const image = byRow.get(2)!;
    expect(image.ok).toBe(true);
    if (!image.ok) return;
    expect(image.contentType).toBe("image/png");
    expect(image.byteLength).toBe(PNG.byteLength);
    // The hash is what commit turns into the Storage path, so it must be the
    // hash of the ORIGINAL bytes after a full write/read round-trip.
    expect(image.sha256).toBe(createHash("sha256").update(PNG).digest("hex"));
  });

  it("keys separate pictures to their own rows", async () => {
    const { buffer, workbook, worksheet } = await workbookWith([
      { buffer: PNG, extension: "png", col: IMAGE_COL - 1, row: 1 },
      { buffer: GIF, extension: "gif", col: IMAGE_COL - 1, row: 2 },
    ]);

    const { byRow } = await extractRowImages(buffer, workbook, worksheet, IMAGE_COL);
    expect(byRow.get(2)?.ok).toBe(true);
    // Row 3's GIF is found, then rejected on format rather than ignored.
    const gif = byRow.get(3)!;
    expect(gif.ok).toBe(false);
    if (gif.ok) return;
    expect(gif.message).toMatch(/PNG, JPEG or WebP/);
  });

  it("warns instead of silently dropping a picture outside the Image column", async () => {
    const { buffer, workbook, worksheet } = await workbookWith([
      { buffer: PNG, extension: "png", col: 2, row: 1 }, // sitting over Stem
    ]);

    const { byRow, warnings } = await extractRowImages(buffer, workbook, worksheet, IMAGE_COL);
    expect(byRow.size).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/outside the Image column/);
  });

  it("says so when the sheet has pictures but no Image column at all", async () => {
    const { buffer, workbook, worksheet } = await workbookWith([
      { buffer: PNG, extension: "png", col: IMAGE_COL - 1, row: 1 },
    ]);

    const { byRow, warnings } = await extractRowImages(buffer, workbook, worksheet, null);
    expect(byRow.size).toBe(0);
    expect(warnings[0]).toMatch(/no "Image" column/);
  });

  it("keeps the first of two pictures on one row and warns", async () => {
    const { buffer, workbook, worksheet } = await workbookWith([
      { buffer: PNG, extension: "png", col: IMAGE_COL - 1, row: 1 },
      { buffer: GIF, extension: "gif", col: IMAGE_COL - 1, row: 1 },
    ]);

    const { byRow, warnings } = await extractRowImages(buffer, workbook, worksheet, IMAGE_COL);
    expect(byRow.size).toBe(1);
    expect(byRow.get(2)?.ok).toBe(true);
    expect(warnings.some((w) => /more than one picture/.test(w))).toBe(true);
  });

  it("returns nothing and warns about nothing for a sheet with no pictures", async () => {
    const { buffer, workbook, worksheet } = await workbookWith([]);
    const { byRow, warnings } = await extractRowImages(buffer, workbook, worksheet, IMAGE_COL);
    expect(byRow.size).toBe(0);
    expect(warnings).toEqual([]);
  });

  it("rejects a picture over the 5 MB ceiling", async () => {
    // Valid PNG header, then padding — describe() checks size before format.
    const huge = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
    const { buffer, workbook, worksheet } = await workbookWith([
      { buffer: huge, extension: "png", col: IMAGE_COL - 1, row: 1 },
    ]);

    const { byRow } = await extractRowImages(buffer, workbook, worksheet, IMAGE_COL);
    const image = byRow.get(2)!;
    expect(image.ok).toBe(false);
    if (image.ok) return;
    expect(image.message).toMatch(/5 MB or smaller/);
  });
});

describe("sha256Hex", () => {
  it("matches node's own digest", () => {
    expect(sha256Hex(new Uint8Array(PNG))).toBe(
      createHash("sha256").update(PNG).digest("hex")
    );
  });

  it("is content-addressed — identical bytes hash identically", () => {
    // This is what makes re-importing the same sheet reuse Storage objects.
    expect(sha256Hex(new Uint8Array(PNG))).toBe(sha256Hex(new Uint8Array(Buffer.from(PNG))));
  });
});

// ── URL images ──────────────────────────────────────────────

describe("fetchImageFromUrl", () => {
  // Every case below is refused before any socket is opened.
  const fetchSpy = vi.fn();
  beforeAll(() => {
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("refuses plain http", async () => {
    const result = await fetchImageFromUrl("http://example.com/a.png");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/https:\/\//);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a malformed URL", async () => {
    const result = await fetchImageFromUrl("not a url");
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["https://127.0.0.1/x.png", "loopback"],
    ["https://10.1.2.3/x.png", "private range"],
    ["https://192.168.0.5/x.png", "private range"],
    ["https://172.16.4.4/x.png", "private range"],
    ["https://169.254.169.254/latest/meta-data", "cloud metadata endpoint"],
    ["https://[::1]/x.png", "IPv6 loopback"],
  ])("refuses %s", async (url) => {
    const result = await fetchImageFromUrl(url);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/private network address/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
