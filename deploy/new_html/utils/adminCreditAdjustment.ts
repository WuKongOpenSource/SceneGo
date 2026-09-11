export function normalizeAdminCreditAdjustmentAmountInput(rawValue: string): string {
  if (rawValue === '' || rawValue === '-') return rawValue;
  const negative = rawValue.startsWith('-');
  const digits = negative ? rawValue.slice(1) : rawValue;
  const normalizedDigits = digits.replace(/^0+(?=\d)/, '');
  return `${negative ? '-' : ''}${normalizedDigits}`;
}

export function parseAdminCreditAdjustmentAmount(rawValue: string): number | null {
  if (!/^-?\d+$/.test(rawValue)) return null;
  const amount = Number(rawValue);
  return Number.isSafeInteger(amount) && amount !== 0 ? amount : null;
}
