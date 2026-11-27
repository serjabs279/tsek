import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { isDesktop } from '@shared/lib/desktop';
import { downloadText } from '@shared/lib/download';

export interface SaveTextOptions {
  mime: string;
  label: string;
  extension: string;
}

/**
 * Save JSON or CSV on the tablet through Android's own file picker, the same
 * way sheet PDFs are saved. In the browser preview there is no picker, so the
 * text falls back to an ordinary download.
 *
 * Returns false when the teacher backs out of the picker; callers should not
 * claim a file was saved in that case.
 */
export async function saveTextFile(
  content: string,
  filename: string,
  options: SaveTextOptions
): Promise<boolean> {
  if (!isDesktop) {
    downloadText(content, filename, options.mime);
    return true;
  }
  const target = await save({
    defaultPath: filename,
    filters: [{ name: options.label, extensions: [options.extension] }],
  });
  if (!target) return false;
  await writeTextFile(target, content);
  return true;
}