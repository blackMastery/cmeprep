import { describe, expect, it } from "vitest";
import {
  columnOfCellRef,
  mapInCellImages,
  resolveSheetPath,
  rowOfCellRef,
  sniffImageType,
} from "@/lib/admin/import-images-core";

// ── Magic bytes ─────────────────────────────────────────────

const bytes = (...values: number[]) => new Uint8Array(values);

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46);
const WEBP = bytes(
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00, // size — deliberately arbitrary
  0x57, 0x45, 0x42, 0x50, // WEBP
  0x56, 0x50, 0x38, 0x20
);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00);

describe("sniffImageType", () => {
  it("identifies the three formats the bucket accepts", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });

  it("rejects GIF — Storage's allowed_mime_types would refuse it anyway", () => {
    expect(sniffImageType(GIF)).toBeNull();
  });

  it("rejects an SVG, which is markup rather than an image", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">');
    expect(sniffImageType(svg)).toBeNull();
  });

  it("rejects a truncated header rather than guessing", () => {
    expect(sniffImageType(bytes(0x89, 0x50))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it("does not mistake a bare RIFF container for WebP", () => {
    // RIFF....WAVE — a sound file, not an image.
    const wav = bytes(
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45
    );
    expect(sniffImageType(wav)).toBeNull();
  });

  it("accepts a JPEG whose third byte is any marker", () => {
    // Exif (0xE1) rather than JFIF (0xE0).
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10))).toBe("image/jpeg");
  });
});

// ── Cell references ─────────────────────────────────────────

describe("cell reference helpers", () => {
  it("reads row numbers", () => {
    expect(rowOfCellRef("N2")).toBe(2);
    expect(rowOfCellRef("AA1583")).toBe(1583);
    expect(rowOfCellRef("N")).toBeNull();
    expect(rowOfCellRef("$N$2")).toBeNull();
  });

  it("reads 1-based column indexes, matching exceljs", () => {
    expect(columnOfCellRef("A1")).toBe(1);
    expect(columnOfCellRef("N1")).toBe(14);
    expect(columnOfCellRef("Z1")).toBe(26);
    expect(columnOfCellRef("AA1")).toBe(27);
    expect(columnOfCellRef("AB1")).toBe(28);
  });
});

// ── Worksheet part lookup ───────────────────────────────────

describe("resolveSheetPath", () => {
  const workbookXml = `<workbook><sheets>
    <sheet name="Notes" sheetId="1" r:id="rId3"/>
    <sheet name="Questions" sheetId="2" r:id="rId1"/>
  </sheets></workbook>`;
  const relsXml = `<Relationships>
    <Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet7.xml"/>
    <Relationship Id="rId3" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/>
  </Relationships>`;

  it("follows the r:id rather than assuming tab order", () => {
    // "Questions" is the second tab but lives in sheet7.xml.
    expect(resolveSheetPath(workbookXml, relsXml, "Questions")).toBe(
      "xl/worksheets/sheet7.xml"
    );
  });

  it("resolves targets relative to xl/", () => {
    expect(resolveSheetPath(workbookXml, relsXml, "Notes")).toBe(
      "xl/worksheets/sheet1.xml"
    );
  });

  it("handles an absolute target", () => {
    const abs = `<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet2.xml"/></Relationships>`;
    expect(resolveSheetPath(workbookXml, abs, "Questions")).toBe(
      "xl/worksheets/sheet2.xml"
    );
  });

  it("returns null for an unknown sheet name", () => {
    expect(resolveSheetPath(workbookXml, relsXml, "Missing")).toBeNull();
  });

  it("matches a name containing an escaped entity", () => {
    const wb = `<workbook><sheets><sheet name="Q&amp;A" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    expect(resolveSheetPath(wb, relsXml, "Q&A")).toBe("xl/worksheets/sheet7.xml");
  });
});

// ── In-cell images ──────────────────────────────────────────

/**
 * The five parts Excel writes for two "Place in Cell" pictures, laid out the
 * way it actually lays them out.
 */
const FIXTURE = {
  sheetXml: `<worksheet><sheetData>
    <row r="2"><c r="A2" t="s"><v>0</v></c><c r="N2" s="1" t="e" vm="1"><v>#VALUE!</v></c></row>
    <row r="3"><c r="N3" s="1" t="e" vm="2"><v>#VALUE!</v></c></row>
    <row r="4"><c r="N4" s="1"><v>plain</v></c></row>
  </sheetData></worksheet>`,
  metadataXml: `<metadata>
    <metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000"/></metadataTypes>
    <futureMetadata name="XLRICHVALUE" count="2">
      <bk><extLst><ext uri="{3e2802c4}"><xlrd:rvb i="0"/></ext></extLst></bk>
      <bk><extLst><ext uri="{3e2802c4}"><xlrd:rvb i="1"/></ext></extLst></bk>
    </futureMetadata>
    <valueMetadata count="2">
      <bk><rc t="1" v="0"/></bk>
      <bk><rc t="1" v="1"/></bk>
    </valueMetadata>
  </metadata>`,
  rdRichValueXml: `<rvData count="2">
    <rv s="0"><v>0</v><v>5</v></rv>
    <rv s="0"><v>1</v><v>5</v></rv>
  </rvData>`,
  structureXml: `<rvStructures count="1">
    <s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s>
  </rvStructures>`,
  richValueRelXml: `<richValueRels><rel r:id="rId1"/><rel r:id="rId2"/></richValueRels>`,
  relsXml: `<Relationships>
    <Relationship Id="rId1" Type="http://x/image" Target="../media/image1.png"/>
    <Relationship Id="rId2" Type="http://x/image" Target="../media/image2.jpeg"/>
  </Relationships>`,
};

describe("mapInCellImages", () => {
  it("walks the full chain from cell to media part", () => {
    const map = mapInCellImages(FIXTURE);
    expect(map.get("N2")).toBe("xl/media/image1.png");
    expect(map.get("N3")).toBe("xl/media/image2.jpeg");
  });

  it("ignores cells with no vm attribute", () => {
    const map = mapInCellImages(FIXTURE);
    expect(map.has("N4")).toBe(false);
    expect(map.has("A2")).toBe(false);
    expect(map.size).toBe(2);
  });

  it("honours a structure that puts the identifier at a later position", () => {
    const map = mapInCellImages({
      ...FIXTURE,
      structureXml: `<rvStructures><s><k n="CalcOrigin" t="i"/><k n="_rvRel:LocalImageIdentifier" t="i"/></s></rvStructures>`,
      // Second <v> now holds the rel index; first is a decoy pointing at 1.
      rdRichValueXml: `<rvData><rv s="0"><v>1</v><v>0</v></rv></rvData>`,
    });
    expect(map.get("N2")).toBe("xl/media/image1.png");
  });

  it("falls back to the first value when the structure part is absent", () => {
    const map = mapInCellImages({ ...FIXTURE, structureXml: undefined });
    expect(map.get("N2")).toBe("xl/media/image1.png");
    expect(map.get("N3")).toBe("xl/media/image2.jpeg");
  });

  it("falls back to identity when futureMetadata is missing", () => {
    // Some generators omit it; rc/@v is then already the rich value index.
    const map = mapInCellImages({
      ...FIXTURE,
      metadataXml: `<metadata>
        <metadataTypes count="1"><metadataType name="XLRICHVALUE"/></metadataTypes>
        <valueMetadata count="2"><bk><rc t="1" v="0"/></bk><bk><rc t="1" v="1"/></bk></valueMetadata>
      </metadata>`,
    });
    expect(map.get("N2")).toBe("xl/media/image1.png");
    expect(map.get("N3")).toBe("xl/media/image2.jpeg");
  });

  it("respects a non-identity futureMetadata mapping", () => {
    const map = mapInCellImages({
      ...FIXTURE,
      metadataXml: FIXTURE.metadataXml
        .replace('<xlrd:rvb i="0"/>', '<xlrd:rvb i="1"/>')
        .replace('<xlrd:rvb i="1"/></ext></extLst></bk>\n    </futureMetadata>', '<xlrd:rvb i="0"/></ext></extLst></bk>\n    </futureMetadata>'),
    });
    // First cell now points at the SECOND rich value.
    expect(map.get("N2")).toBe("xl/media/image2.jpeg");
  });

  it("skips valueMetadata blocks belonging to another metadata type", () => {
    const map = mapInCellImages({
      ...FIXTURE,
      metadataXml: FIXTURE.metadataXml
        .replace(
          '<metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000"/></metadataTypes>',
          '<metadataTypes count="2"><metadataType name="XLDAPR"/><metadataType name="XLRICHVALUE"/></metadataTypes>'
        )
        // The first block keeps t="1", which is now XLDAPR, so it must be
        // ignored; only the second is a rich value.
        .replace('<bk><rc t="1" v="1"/></bk>', '<bk><rc t="2" v="1"/></bk>'),
    });
    expect(map.has("N2")).toBe(false);
    expect(map.get("N3")).toBe("xl/media/image2.jpeg");
  });

  it("returns nothing when the rels part is empty", () => {
    expect(mapInCellImages({ ...FIXTURE, relsXml: "<Relationships/>" }).size).toBe(0);
  });

  it("returns nothing rather than throwing on garbage", () => {
    expect(
      mapInCellImages({
        sheetXml: "not xml",
        metadataXml: "",
        rdRichValueXml: "",
        richValueRelXml: "",
        relsXml: "",
      }).size
    ).toBe(0);
  });
});
