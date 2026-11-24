import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { isDesktop } from '@shared/lib/desktop';
import { downloadBlob } from '@shared/lib/download';

/**
 * Save a generated PDF on the tablet.
 *
 * Android has no print dialog worth trusting from a webview, so every
 * "print" action becomes a PDF instead: the system picker asks where the file
 * goes (Downloads, Drive, a folder of choice), and the fs plugin writes the
 * bytes to the returned content:// URI. In the browser preview there is no
 * picker, so the same bytes fall back to an ordinary download.
 *
 * Returns false when the teacher backs out of the picker; callers should not
 * claim a file was saved in that case.
 */
export async function savePdf(bytes: Uint8Array, filename: string): Promise<boolean> {
  if (!isDesktop) {
    downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename);
    return true;
  }
  const target = await save({
    defaultPath: filename,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  });
  if (!target) return false;
  await writeFile(target, bytes);
  return true;
}
