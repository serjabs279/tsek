/**
 * Print an HTML document without disturbing the app shell. Printing an iframe
 * keeps the app's own styles out of the page and avoids pop-up blockers.
 */
export function printHtml(html: string): boolean {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return false;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const run = () => {
    const view = frame.contentWindow;
    if (!view) {
      frame.remove();
      return;
    }
    view.focus();
    view.print();
    window.setTimeout(() => frame.remove(), 60000);
  };

  // Give the document one frame to lay out before opening the print dialog.
  window.setTimeout(run, 250);
  return true;
}
