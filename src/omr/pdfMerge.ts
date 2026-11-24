import { PDFDocument } from 'pdf-lib';

/** Join PDFs in order, keeping every page as-is. */
export async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of parts) {
    if (bytes.length === 0) continue;
    const source = await PDFDocument.load(bytes);
    const pages = await out.copyPages(source, source.getPageIndices());
    pages.forEach((page) => out.addPage(page));
  }
  return out.save();
}
