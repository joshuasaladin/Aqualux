/**
 * Safe test harness using the real sample submission (Michele's Floating
 * Breakfast). Nothing here ever emails a guest.
 *
 *   dryRunSample()          — parse + match + price + compose, logs
 *                             everything, touches NOTHING (no Drive, no
 *                             Gmail, no log sheet).
 *   testSampleSubmission()  — full run: real invoice sheet + PDF + a Gmail
 *                             DRAFT addressed to YOU (owner), plus a log row
 *                             marked TEST.
 *
 * Expected result: Big Breakfast, total $155.00, downpayment $15.00,
 * remaining $140.00, location "casa Hermanas Diamanté".
 */
const SAMPLE_BODY = [
  'A site visitor just submitted your form Floating Breakfast on Aqua Lux Aruba',
  '',
  'Submission summary:',
  '',
  'First name:',
  'Michele',
  '',
  'Last name:',
  'Defilippis',
  '',
  'Email:',
  'flipper01@yahoo.com',
  '',
  'Select a date:',
  '2026-07-09',
  '',
  'Select a time:',
  '08:30',
  '',
  'Choose your Breakfast:',
  'Big Breakfast',
  '',
  'Where are you staying?:',
  'Other',
  '',
  'Any Questions? (specify extra options):',
  'We are at casa Hermanas',
  'Diamanté',
  '',
  'View Submissions'
].join('\n');

function parseSample_() {
  const fakeMessage = {
    getPlainBody: () => SAMPLE_BODY,
    getFrom: () => 'Aqua Lux Aruba via Wix <no-reply@wix.com>',
    getId: () => 'TEST-SAMPLE-' + Date.now(),
    getDate: () => new Date()
  };
  return parseWixNotification(fakeMessage);
}

/** Step 1: inspect every computed value without touching anything. */
function dryRunSample() {
  const sub = parseSample_();
  Logger.log('Parsed submission: %s', JSON.stringify(sub, null, 2));

  const service = findServiceByFormName(sub.formName);
  if (!service) throw new Error('Form not matched to catalog: ' + sub.formName);
  const match = matchVariant(service, sub);
  if (!match.variant) throw new Error('Variant not matched: ' + JSON.stringify(match));
  Logger.log('Matched: %s → %s', service.name, match.variant.name);

  const pricing = priceSubmission(service, match.variant, sub);
  Logger.log('Pricing: %s', JSON.stringify(pricing));
  if (pricing.status !== 'ok') throw new Error('Expected priceable submission, got: ' + JSON.stringify(pricing));
  if (pricing.total !== 155 || pricing.downpayment !== 15 || pricing.remaining !== 140) {
    throw new Error('UNEXPECTED NUMBERS — total ' + pricing.total + ', down ' + pricing.downpayment + ', remaining ' + pricing.remaining);
  }

  const email = composeInvoiceEmail(sub, service, match.variant, pricing, 'AQL-TEST-0000');
  Logger.log('--- EMAIL SUBJECT ---\n%s', email.subject);
  Logger.log('--- EMAIL BODY ---\n%s', email.body);
  Logger.log('DRY RUN PASSED ✓  (total $155, downpayment $15, remaining $140)');
}

/** Step 2: full end-to-end test; the draft goes to YOUR inbox, not the guest. */
function testSampleSubmission() {
  const sub = parseSample_();
  const service = findServiceByFormName(sub.formName);
  const variant = matchVariant(service, sub).variant;
  const pricing = priceSubmission(service, variant, sub);
  if (pricing.status !== 'ok') throw new Error('Pricing failed: ' + JSON.stringify(pricing));

  const invoiceNumber = nextInvoiceNumber_();
  const invoice = generateInvoice_(sub, service, variant, pricing, invoiceNumber);
  const email = composeInvoiceEmail(sub, service, variant, pricing, invoiceNumber);

  // Test draft goes to the owner regardless of DRAFT_MODE.
  GmailApp.createDraft(CONFIG.OWNER_EMAIL, '[TEST] ' + email.subject, email.body,
    { name: CONFIG.BUSINESS_NAME, attachments: [invoice.pdf] });

  appendLog_({
    guestName: 'Michele Defilippis', email: sub.email,
    service: pricing.lineDescription,
    dateRequested: formatDateShort_(sub.date),
    invoiceNumber: invoiceNumber,
    downpayment: pricing.downpayment, total: pricing.total,
    status: 'TEST', notes: 'testSampleSubmission() run',
    messageId: sub.messageId
  });

  Logger.log('TEST PASSED ✓ — a draft addressed to %s is in your Drafts folder with invoice %s attached.',
    CONFIG.OWNER_EMAIL, invoiceNumber);
  Logger.log('Invoice sheet copy: https://docs.google.com/spreadsheets/d/' + invoice.fileId);
}

/**
 * Diagnostic: shows every email the pipeline's search finds and exactly why
 * each one is or isn't processed. Read-only — sends nothing, changes nothing.
 * Run it, then read the Execution log.
 */
function debugInbox() {
  const handledIds = processedMessageIds_();
  const threads = GmailApp.search(CONFIG.GMAIL_QUERY);
  Logger.log('Search query: %s', CONFIG.GMAIL_QUERY);
  Logger.log('Threads found: %s', threads.length);

  threads.forEach(thread => {
    thread.getMessages().forEach(m => {
      const from = (m.getFrom() || '');
      const body = m.getPlainBody() || '';
      const senderOk = CONFIG.WIX_SENDER_PATTERNS.some(p => from.toLowerCase().indexOf(p) !== -1);
      const signatureOk = /a site visitor just submitted your form/i.test(body);
      const done = !!handledIds[m.getId()];
      let verdict;
      if (done) verdict = 'SKIP — already processed (logged)';
      else if (!senderOk) verdict = 'SKIP — sender is not Wix (add its domain to WIX_SENDER_PATTERNS in Config if this is a real Wix notification)';
      else if (!signatureOk) verdict = 'SKIP — body is missing the "A site visitor just submitted your form" line';
      else verdict = 'WILL PROCESS on next run';
      Logger.log('• "%s" | from: %s | %s | %s', m.getSubject(), from,
        Utilities.formatDate(m.getDate(), CONFIG.TIMEZONE, 'MM/dd HH:mm'), verdict);
    });
  });

  const spam = GmailApp.search('in:spam "A site visitor just submitted your form"');
  if (spam.length) Logger.log('⚠ %s matching thread(s) are in SPAM — the pipeline does not read spam. Mark them "Not spam".', spam.length);
  Logger.log('Done. If a message says WILL PROCESS, run processInbox (or wait 5 min) and check Drafts + the log sheet.');
}
