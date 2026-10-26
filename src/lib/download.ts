import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './desktop';

export function safeFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * A browser download would land in the webview's own folder, which is not
 * somewhere a teacher can find a sheet PDF. Inside the desktop shell the file
 * goes through a normal Windows save dialog instead.
 */
async function saveWithDialog(blob: Blob, filename: string): Promise<void> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await invoke<string | null>('save_export', { filename, bytes: Array.from(bytes) });
  } catch (error) {
    console.error('[Tsek] The file could not be saved', error);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  if (isDesktop) {
    void saveWithDialog(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export function downloadText(content: string, filename: string, mime: string): void {
  downloadBlob(new Blob([content], { type: `${mime};charset=utf-8` }), filename);
}

export function downloadJson(value: unknown, filename: string): void {
  downloadText(JSON.stringify(value, null, 2), filename, 'application/json');
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsText(file);
  });
}
