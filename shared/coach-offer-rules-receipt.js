// Display and durable conversation history share the exact persisted action
// receipt. Generated prose is not proof that settings were saved.
export function formatOfferRulesReceipt(receipt) {
  if (!receipt) return '';
  if (!receipt.changed) return 'Your Offer Analyzer settings already match this request.';
  const displayValue = (value, path) => {
    if (typeof value === 'boolean') return value ? 'On' : 'Off';
    if (value == null) return 'Not set';
    if (Array.isArray(value) && path?.endsWith('.accept_ladder')) {
      return value.length ? value.map(rung => [
        rung.min_per_mile != null && `at least $${rung.min_per_mile}/mi`,
        rung.min_per_minute != null && `at least $${rung.min_per_minute}/min`,
        rung.min_total_min != null && `at least ${rung.min_total_min} minutes`,
        rung.min_total_min_excl != null && `more than ${rung.min_total_min_excl} minutes`,
        rung.max_total_min != null && `up to ${rung.max_total_min} minutes`,
        rung.max_total_min_excl != null && `under ${rung.max_total_min_excl} minutes`,
      ].filter(Boolean).join(', ')).join('; or ') : 'None';
    }
    if (typeof value === 'object') return value.label ?? JSON.stringify(value);
    const modes = { destination_in: 'Destination inside area', heads_toward: 'Heading toward area', north_of: 'North of place', south_of: 'South of place' };
    return modes[value] ?? String(value);
  };
  return `Offer Analyzer settings saved.\n\n${receipt.changes.map(change =>
    `- ${change.label}: ${displayValue(change.before, change.path)} → ${displayValue(change.after, change.path)}`).join('\n')}`;
}
