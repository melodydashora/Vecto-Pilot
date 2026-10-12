import { stripActionTags } from './stripActionTags';
import type { DonePayloadMeta } from './actionsResult';
import { formatOfferRulesReceipt } from '@shared/coach-offer-rules-receipt.js';

// Spoken/displayed save confirmation comes from the server's durable receipts,
// after action validation. Partial text is never proof of a completed request.
export function confirmedCoachReply(text: string, done?: DonePayloadMeta): string {
  if (!done?.done) return 'The connection ended before Coach could confirm this request. Please check your saved settings, notes or reported memos before trying again.';
  if (done.error) return typeof done.error === 'string' ? done.error : 'Coach could not complete this request. Please try again.';
  const receipts = (done.actions_result?.memos || [])
    .map(memo => `Saved reported memo: ${memo.title} (receipt ${memo.id.slice(0, 8)}).`);
  const rules = done.actions_result?.offer_rules;
  const errors = done.actions_result?.errors || [];
  const response = stripActionTags(done.response_text ?? text);
  const settingsReceipt = formatOfferRulesReceipt(rules);
  if (settingsReceipt && (errors.length || !response.startsWith(settingsReceipt))) receipts.push(settingsReceipt);
  const parts = errors.length
    ? [`Some requested changes were not saved: ${errors.join('; ')}. Please check your settings, notes and memos before trying again.`]
    : [response];
  if (errors.length) parts.push(...receipts);
  else parts.unshift(...receipts);
  if (done.persistence_error) parts.push('This reply could not be saved to conversation history. Confirmed changes above remain saved.');
  return parts.filter(Boolean).join('\n\n');
}
