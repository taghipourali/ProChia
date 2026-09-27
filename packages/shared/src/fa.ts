const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Persian thousands separator (U+066C) — what Persian typesetting expects instead of a comma. */
const FA_THOUSANDS = '٬';
const FA_DECIMAL = '٫';

export function toFaDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]!);
}

/** Normalizes Persian/Arabic digits to ASCII so user input can be parsed. */
export function toEnDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

export function formatNumber(value: number, fractionDigits = 0): string {
  const fixed = Math.abs(value).toFixed(fractionDigits);
  const [intPart, fracPart] = fixed.split('.') as [string, string | undefined];
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, FA_THOUSANDS);
  const trimmedFrac = fracPart?.replace(/0+$/, '');
  const body = trimmedFrac ? `${grouped}${FA_DECIMAL}${trimmedFrac}` : grouped;
  return toFaDigits(value < 0 ? `−${body}` : body);
}

export function formatToman(amount: number, { unit = true }: { unit?: boolean } = {}): string {
  const n = formatNumber(Math.round(amount));
  return unit ? `${n} تومان` : n;
}

/** Compact form for tight UI: ۱٫۲ میلیون / ۳۸۵ هزار. */
export function formatTomanCompact(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) return `${formatNumber(amount / 1_000_000, 1)} میلیون`;
  if (Math.abs(amount) >= 1_000) return `${formatNumber(amount / 1_000, 0)} هزار`;
  return formatNumber(amount);
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return `${formatNumber(value, fractionDigits)}٪`;
}

/**
 * Normalizes Iranian mobile numbers to the 09xxxxxxxxx form.
 * Accepts Persian digits, spaces, dashes, and +98 / 0098 / 98 prefixes.
 */
export function normalizeIranMobile(input: string): string | null {
  const digits = toEnDigits(input).replace(/[\s\-()]/g, '');
  const m = /^(?:\+98|0098|98|0)?(9\d{9})$/.exec(digits);
  return m ? `0${m[1]}` : null;
}

export function maskMobile(phone: string): string {
  return toFaDigits(`${phone.slice(0, 4)}•••${phone.slice(-4)}`);
}
