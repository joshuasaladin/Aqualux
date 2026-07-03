/**
 * YOUR ANSWER RULES — edit this file to teach the pipeline how to answer
 * common guest questions. No other file needs to change.
 *
 * Each rule has:
 *   match:  keywords (lowercase). If ANY of them appears in the guest's
 *           "Any Questions?" text, the rule fires.
 *   answer: the exact sentence(s) sent to the guest, written in your voice.
 *
 * Rules are checked before the AI answerer — a matching rule always wins,
 * so anything answered here is 100% under your control. Keep answers
 * guest-safe: no vendor names, no internal info (the leak guard will block
 * the email otherwise).
 */
const ANSWER_RULES = [
  {
    match: ['pay', 'payment', 'zelle', 'venmo', 'bank transfer', 'cash'],
    answer: 'The downpayment can be paid via Zelle (aqualuxaruba@gmail.com), Venmo (@AquaLuxAruba), or bank transfer in Aruba — the details are on your invoice. The remaining balance is settled on the day of your experience.'
  },
  {
    match: ['cancel', 'refund', 'reschedule'],
    answer: 'Cancellations more than two weeks before your service date receive a full refund; within two weeks of the date the downpayment is non-refundable. If you need to move your date, just reply here and we will do our best to accommodate.'
  },
  {
    match: ['massage location', 'come to us', 'come to our'],
    answer: 'Our massage therapists come directly to you — your villa, condo, or resort — so all you need to do is relax.'
  }

  // ── Add your own rules below. Example: ─────────────────────────────
  // {
  //   match: ['gluten', 'allerg', 'dietary'],
  //   answer: 'We happily accommodate dietary needs — just let us know the details and we will arrange it with the kitchen.'
  // },
];

/**
 * Returns the answers of every rule whose keywords appear in the guest's
 * question text (deduplicated), or an empty array.
 */
function findRuleAnswers_(questionText) {
  const q = String(questionText || '').toLowerCase();
  if (!q) return [];
  const answers = [];
  for (const rule of ANSWER_RULES) {
    if (rule.match.some(kw => q.indexOf(kw.toLowerCase()) !== -1)
        && answers.indexOf(rule.answer) === -1) {
      answers.push(rule.answer);
    }
  }
  return answers;
}
