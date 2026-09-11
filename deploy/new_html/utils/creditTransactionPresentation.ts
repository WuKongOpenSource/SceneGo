type CreditTransactionLike = {
  operation_reason?: unknown;
  metadata?: unknown;
};

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function nonEmptyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * New schemas store the administrator's note in operation_reason. Older or
 * degraded schemas retain it in metadata, so the ledger UI must support both.
 */
export function getCreditTransactionReason(transaction: CreditTransactionLike): string {
  const metadata = normalizeMetadata(transaction.metadata);
  return nonEmptyText(transaction.operation_reason)
    || nonEmptyText(metadata.operation_reason)
    || nonEmptyText(metadata.reason);
}
