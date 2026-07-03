/**
 * Outbound leak guard.
 *
 * The concierge info sheet is INTERNAL: vendor identities, contacts, booking
 * methods and commission language must never reach a guest. Every outgoing
 * email body/subject and every invoice value passes through
 * assertGuestSafe_() before a draft is created or anything is sent; a hit
 * aborts that submission and routes it to needs-review instead.
 *
 * This list itself is internal — it exists only inside the script project
 * and is never rendered anywhere guest-facing.
 */
const INTERNAL_TERMS = [
  // Vendor / company names from the info sheet
  'jolly pirates', 'pelican adventures', 'pelican-aruba', 'around aruba tours',
  'aroundarubatours', 'awa aruba', 'awaaruba', 'island cabana', 'my lovely body',
  'dining memories', 'flo chef', 'picnic aruba', "eduardo's", 'eduardos',
  'express your feelings', 'ec tours', 'turo car rental', 'turo',
  // Vendor contact people
  'ethan nagtegaal', 'benji', 'quinten',
  // Vendor phone numbers / emails
  '5942716', '5621602', '6626285', '5631793', '5926644', '7349001',
  '7488240', '7401794', '6990175', '6999823', '5693588', '7308338',
  'info@pelican-aruba.com', 'booking@awaaruba.com', 'sales@aroundarubatours.com',
  // Internal business language
  'commission', 'wholesale', 'vendor', 'booking method', 'fare harbour',
  'ticket book', 'net rate', 'markup'
];

/**
 * Throws if guest-facing text contains anything internal.
 * `context` names the artifact (e.g. "email body") for the error message.
 */
function assertGuestSafe_(text, context) {
  const hay = String(text || '').toLowerCase();
  for (const term of INTERNAL_TERMS) {
    if (hay.indexOf(term) !== -1) {
      throw new Error('LEAK GUARD: internal term "' + term + '" found in ' + context + ' — blocked.');
    }
  }
}
