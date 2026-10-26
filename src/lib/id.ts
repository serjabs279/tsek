export function uid(prefix = ''): string {
  const random = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}${prefix ? '-' : ''}${time}${random}`.toUpperCase();
}

export function examCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `EX-${out}`;
}

export function todayISO(): string {
  return new Date().toISOString();
}
