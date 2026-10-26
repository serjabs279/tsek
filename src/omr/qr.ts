import QRCode from 'qrcode';
import jsQR from 'jsqr';

export interface SheetQrPayload {
  v: 1;
  t: 'SRPHS-EXAM';
  e: string;
  l: string;
}

export function makeSheetQrPayload(examCode: string, lrn: string): string {
  const payload: SheetQrPayload = { v: 1, t: 'SRPHS-EXAM', e: examCode, l: lrn };
  return JSON.stringify(payload);
}

export function parseSheetQr(raw: string): { examCode: string; lrn: string } | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SheetQrPayload>;
    if (parsed && parsed.t === 'SRPHS-EXAM' && typeof parsed.e === 'string' && typeof parsed.l === 'string') {
      return { examCode: parsed.e.trim().toUpperCase(), lrn: parsed.l.replace(/[\s-]/g, '') };
    }
  } catch {
    // Legacy plain payload fallback below.
  }
  const legacy = raw.match(/^(EX-[A-Z0-9]{4,10})\|(\d{8,14})$/i);
  if (legacy) {
    return { examCode: legacy[1].toUpperCase(), lrn: legacy[2] };
  }
  return null;
}

export async function makeQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 640,
    color: { dark: '#14120e', light: '#ffffff' },
  });
}

/** Decode a QR from RGBA pixels. Returns null when no code is readable. */
export function decodeQrPixels(data: Uint8ClampedArray, width: number, height: number): string | null {
  return decodeQrDetailed(data, width, height)?.data ?? null;
}

export interface QrDecodeResult {
  data: string;
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
}

export function decodeQrDetailed(
  data: Uint8ClampedArray,
  width: number,
  height: number
): QrDecodeResult | null {
  try {
    const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
    if (!result?.data) return null;
    return {
      data: result.data,
      topLeft: result.location.topLeftCorner,
      topRight: result.location.topRightCorner,
    };
  } catch {
    return null;
  }
}
