export function formatOfferRulesReceipt(receipt: {
  changed: boolean;
  changes: { path?: string; label: string; before: unknown; after: unknown }[];
} | undefined | null): string;
