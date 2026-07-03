/**
 * Guest-facing email composition — warm, personal, luxury-concierge voice.
 * All bodies pass the leak guard before leaving Compose.
 */

/** Invoice/confirmation email for a fully priced inquiry. */
function composeInvoiceEmail(sub, service, variant, pricing, invoiceNumber) {
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
service.description + '\n\n' +
'Your total for this experience is ' + money_(pricing.total) + '. To secure your reservation, a downpayment of ' +
money_(pricing.downpayment) + ' is required, with the remaining ' + money_(pricing.remaining) +
' due on the day of your experience.\n\n' +
'Downpayment can be made via any of the following:\n' +
CONFIG.PAYMENT_OPTIONS.map(p => '   •  ' + p).join('\n') + '\n\n' +
'Cancellation policy: ' + CONFIG.CANCELLATION_POLICY + '\n\n' +
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
function composeClarificationEmail(sub, service, missing) {
  const first = sub.firstName || 'there';
  const svcName = service ? service.name : 'your experience';

  const body =
'Dear ' + first + ',\n\n' +
'Thank you for your inquiry with Aqua Lux Aruba — we would love to arrange ' + svcName + ' for you.\n\n' +
'To prepare your reservation and exact pricing, could you let us know:\n\n' +
missing.map(m => '   •  ' + capitalize_(m)) .join('\n') + '\n\n' +
'As soon as we hear back, we will send over your confirmation and invoice right away.\n\n' +
'Warm regards,\n' +
'The Aqua Lux Aruba Team\n' +
CONFIG.WEBSITE;

  const subject = 'Your Aqua Lux Aruba Inquiry — one quick question';
  assertGuestSafe_(subject, 'email subject');
  assertGuestSafe_(body, 'email body');
  return { subject: subject, body: body };
}

/** Warm holding reply for requests we can't price from the catalog. */
function composeFollowUpEmail(sub, serviceName) {
  const first = sub.firstName || 'there';
  const what = serviceName || 'the experience you have in mind';

  const body =
'Dear ' + first + ',\n\n' +
'Thank you for reaching out to Aqua Lux Aruba — we would love to arrange ' + what + ' for you.\n\n' +
'To make sure every detail is exactly right, Joshua will follow up with you personally with the ' +
'options and pricing, usually within the day.\n\n' +
'Warm regards,\n' +
'The Aqua Lux Aruba Team\n' +
CONFIG.WEBSITE;

  const subject = 'Your Aqua Lux Aruba Inquiry — we\'re on it';
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
