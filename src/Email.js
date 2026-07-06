/**
 * Guest-facing email composition — warm, personal, luxury-concierge voice.
 * All bodies pass the leak guard before leaving Compose.
 */

/** Invoice/confirmation email for a fully priced inquiry. */
function composeInvoiceEmail(sub, service, variant, pricing, invoiceNumber, answerText, extraLine) {
  const first = sub.firstName || 'there';
  const dateLine = sub.date ? formatDateDisplay_(sub.date) : null;

  const details = [];
  details.push('Experience: ' + pricing.lineDescription);
  if (dateLine) details.push('Date: ' + dateLine);
  if (sub.timeDisplay) details.push('Time: ' + sub.timeDisplay);
  if (pricing.peopleDisplay) details.push('Party: ' + pricing.peopleDisplay);
  const location = guestLocation_(sub);
  if (location) details.push('Location: ' + location);

  const body =
'Dear ' + first + ',\n\n' +
'Thank you for your inquiry with Aqua Lux Aruba — it would be our pleasure to arrange this for you.\n\n' +
'Here is what we have reserved pending your confirmation:\n\n' +
details.map(d => '   •  ' + d).join('\n') + '\n\n' +
service.description + (extraLine ? '\n\n' + extraLine : '') + '\n\n' +
'Your total for this experience is ' + money_(pricing.total) + '. To secure your reservation, a downpayment of ' +
money_(pricing.downpayment) + ' is required, with the remaining ' + money_(pricing.remaining) +
' due on the day of your experience.\n\n' +
'Downpayment can be made via any of the following:\n' +
CONFIG.PAYMENT_OPTIONS.map(p => '   •  ' + p).join('\n') + '\n\n' +
'Cancellation policy: ' + CONFIG.CANCELLATION_POLICY + '\n\n' +
(answerText ? 'You also asked: "' + sub.questions + '" — ' + answerText + '\n\n' : '') +
'Your invoice (' + invoiceNumber + ') is attached for your records. If any detail above isn\'t quite right, ' +
'simply reply to this email and we will take care of it.\n\n' +
'We look forward to making your time in Aruba unforgettable.\n\n' +
'Warm regards,\n' +
'The Aqua Lux Aruba Team\n' +
CONFIG.WEBSITE;

  const subject = 'Your Aqua Lux Aruba Reservation — ' + pricing.lineDescription +
    (dateLine ? ' · ' + dateLine : '') + ' (Invoice ' + invoiceNumber + ')';

  assertGuestSafe_(subject, 'email subject');
  assertGuestSafe_(body, 'email body');
  return { subject: subject, body: body };
}

/** Clarification email when required details are missing or ambiguous. */
function composeClarificationEmail(sub, service, missing, answerText) {
  const first = sub.firstName || 'there';
  const svcName = service ? service.name : 'your experience';

  const body =
'Dear ' + first + ',\n\n' +
'Thank you for your inquiry with Aqua Lux Aruba — we would love to arrange ' + svcName + ' for you.\n\n' +
'To prepare your reservation and exact pricing, could you let us know:\n\n' +
missing.map(m => '   •  ' + capitalize_(m)) .join('\n') + '\n\n' +
(answerText ? 'To your question — ' + answerText + '\n\n' : '') +
'As soon as we hear back, we will send over your confirmation and invoice right away.\n\n' +
'Warm regards,\n' +
'The Aqua Lux Aruba Team\n' +
CONFIG.WEBSITE;

  const subject = 'Your Aqua Lux Aruba Inquiry — one quick question';
  assertGuestSafe_(subject, 'email subject');
  assertGuestSafe_(body, 'email body');
  return { subject: subject, body: body };
}

/**
 * Warm holding reply for requests we can't price from the catalog.
 * When the service defines a quoteRequest (e.g. "send inspiration
 * pictures"), that ask replaces the generic follow-up promise.
 */
function composeFollowUpEmail(sub, serviceName, quoteRequest) {
  const first = sub.firstName || 'there';
  const what = serviceName || 'the experience you have in mind';

  const body =
'Dear ' + first + ',\n\n' +
'Thank you for reaching out to Aqua Lux Aruba — we would love to arrange ' + what + ' for you.\n\n' +
(quoteRequest
  ? quoteRequest + '\n\n'
  : 'To make sure every detail is exactly right, I will follow up with you personally with the ' +
    'options and pricing, usually within the day.\n\n') +
'Warm regards,\n' +
'The Aqua Lux Aruba Team\n' +
CONFIG.WEBSITE;

  const subject = 'Your Aqua Lux Aruba Inquiry — we\'re on it';
  assertGuestSafe_(subject, 'email subject');
  assertGuestSafe_(body, 'email body');
  return { subject: subject, body: body };
}

/**
 * Price-quote email with booking questions and no invoice (car rentals):
 * states the price, explains payment at pickup, and lists what we need
 * from the guest to confirm the booking.
 */
function composeInquiryEmail(sub, service, variant, answerText) {
  const first = sub.firstName || 'there';

  const body =
'Dear ' + first + ',\n\n' +
'Thank you for your inquiry with Aqua Lux Aruba — great choice!\n\n' +
variant.pricing.priceText + '\n\n' +
(service.inquiryNote ? service.inquiryNote + '\n\n' : '') +
'Let me know if the price works for you — and to get your booking confirmed, could you also send me:\n\n' +
(service.inquiryQuestions || []).map(q => '   •  ' + capitalize_(q)).join('\n') + '\n\n' +
(answerText ? 'To your question — ' + answerText + '\n\n' : '') +
'As soon as I have everything, I will confirm your booking personally.\n\n' +
'Warm regards,\n' +
'The Aqua Lux Aruba Team\n' +
CONFIG.WEBSITE;

  const subject = 'Your Aqua Lux Aruba ' + service.name + ' Inquiry — ' + variant.name;
  assertGuestSafe_(subject, 'email subject');
  assertGuestSafe_(body, 'email body');
  return { subject: subject, body: body };
}

/**
 * Fill-in-the-price draft (airport transfers): states the total as $____
 * for Josh to complete before sending, and collects flight info, phone,
 * and drop-off. NEVER auto-sent — the caller always creates a draft.
 */
function composeManualQuoteEmail(sub, service) {
  const first = sub.firstName || 'there';
  const party = sub.partySize != null ? sub.partySize + ' people' : 'your party';
  const dateLine = sub.date ? ' on ' + formatDateDisplay_(sub.date) : '';

  const body =
'Dear ' + first + ',\n\n' +
'Thank you for your inquiry with Aqua Lux Aruba — I’d be happy to arrange your ' +
service.name.toLowerCase() + dateLine + '.\n\n' +
'The total for ' + party + ' comes out to $____.\n\n' +
'To lock in your transfer, could you send me:\n\n' +
'   •  Your flight information (airline, flight number, and arrival time)\n' +
'   •  The best phone number to reach you\n' +
'   •  Where you’ll need to be dropped off\n\n' +
'Once I have these details, I will confirm everything right away.\n\n' +
'Warm regards,\n' +
'The Aqua Lux Aruba Team\n' +
CONFIG.WEBSITE;

  const subject = 'Your Aqua Lux Aruba ' + service.name + ' Inquiry';
  assertGuestSafe_(subject, 'email subject');
  assertGuestSafe_(body, 'email body');
  return { subject: subject, body: body };
}

/**
 * Menu email for Private Chef inquiries where the guest hasn't picked a
 * menu yet: attaches the menus, lists per-person pricing for their group
 * size, and asks which option they'd like.
 */
function composeMenuEmail(sub, service, optionLines, menuAttached) {
  const first = sub.firstName || 'there';

  const body =
'Dear ' + first + ',\n\n' +
'Thank you for your inquiry with Aqua Lux Aruba — we would love to arrange your ' + service.name + '.\n\n' +
(menuAttached ? 'I’ve attached our menus for you to browse. ' : '') +
(optionLines && optionLines.length
  ? 'For your party of ' + sub.partySize + ', pricing per menu is:\n\n' +
    optionLines.map(l => '   •  ' + l).join('\n') + '\n\n' +
    'Which option would you like? As soon as I hear back, I’ll send over your confirmation and invoice right away.\n\n'
  : 'So I can share exact per-person pricing, could you let me know how many people will be joining — and which menu you’d like?\n\n') +
'Warm regards,\n' +
'The Aqua Lux Aruba Team\n' +
CONFIG.WEBSITE;

  const subject = 'Your Aqua Lux Aruba ' + service.name + ' — menus & pricing';
  assertGuestSafe_(subject, 'email subject');
  assertGuestSafe_(body, 'email body');
  return { subject: subject, body: body };
}

/**
 * Deliver a guest email respecting DRAFT_MODE.
 * Returns 'draft' or 'sent' for logging.
 */
function deliverGuestEmail_(to, email, attachments) {
  const options = { name: CONFIG.BUSINESS_NAME };
  if (attachments && attachments.length) options.attachments = attachments;
  if (CONFIG.DRAFT_MODE) {
    GmailApp.createDraft(to, email.subject, email.body, options);
    return 'draft';
  }
  GmailApp.sendEmail(to, email.subject, email.body, options);
  return 'sent';
}

/** Owner alert for anything flagged needs-review. Always sends (internal). */
function notifyOwner_(subject, body) {
  if (!CONFIG.NOTIFY_OWNER_ON_REVIEW) return;
  GmailApp.sendEmail(CONFIG.OWNER_EMAIL, '[AquaLux Pipeline] ' + subject, body, { name: 'AquaLux Pipeline' });
}

/** Best guest-facing location: named resort, else the free-text note. */
function guestLocation_(sub) {
  const staying = sub.whereStaying;
  if (staying && staying.toLowerCase() !== 'other') return staying;
  // "Other" + a short free-text note often carries the address
  // (e.g. "We are at casa Hermanas Diamanté"). Long notes are left off.
  if (sub.questions && sub.questions.length <= 80) return sub.questions.replace(/^we(\s+are|'re)\s+(at|in|staying at)\s+/i, '');
  return staying || null;
}

function capitalize_(s) {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
