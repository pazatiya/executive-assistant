/**
 * Text extraction for uploaded documents. Runs server-side only.
 * PDF  → unpdf (pdfjs under the hood, serverless-safe)
 * DOCX → mammoth
 * XLSX → sheetjs (each sheet flattened to CSV)
 * CSV / TXT / MD → raw
 * images / other → "" (vision OCR is a later step)
 */

export interface ExtractResult {
  text: string;
  pages?: number;
  note?: string;
}

export async function extractText(buffer: ArrayBuffer, mime: string, filename: string): Promise<ExtractResult> {
  const name = filename.toLowerCase();

  try {
    if (mime.includes("pdf") || name.endsWith(".pdf")) {
      const { extractText: pdfExtract, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(new Uint8Array(buffer));
      const { text, totalPages } = await pdfExtract(doc, { mergePages: true });
      return { text: (Array.isArray(text) ? text.join("\n") : text).trim(), pages: totalPages };
    }

    if (mime.includes("word") || name.endsWith(".docx")) {
      const mammoth = (await import("mammoth")).default ?? (await import("mammoth"));
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      return { text: value.trim() };
    }

    if (mime.includes("sheet") || mime.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(Buffer.from(buffer), { type: "buffer" });
      const parts: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
        parts.push(`# ${sheetName}\n${csv}`);
      }
      return { text: parts.join("\n\n").trim(), note: `${wb.SheetNames.length} גיליונות` };
    }

    if (mime.startsWith("text/") || name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".md")) {
      return { text: new TextDecoder().decode(buffer).trim() };
    }

    if (mime.startsWith("image/")) {
      return { text: "", note: "תמונה — OCR/vision יופעל בשלב הבא" };
    }

    return { text: "", note: `סוג קובץ לא נתמך לחילוץ טקסט: ${mime || name}` };
  } catch (e) {
    return { text: "", note: `שגיאת חילוץ: ${e instanceof Error ? e.message : String(e)}` };
  }
}
