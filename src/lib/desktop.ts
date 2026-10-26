/** True inside the Tauri shell, false when the same build runs in a browser. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
