/**
 * Pipeline entry point. processInbox() is what the time-driven trigger runs
 * (every 5–10 minutes). Each qualifying Wix notification is routed to exactly
 * one outcome:
 *
 *   sent / draft            — invoice PDF + confirmation email
 *   clarification-sent      — friendly email asking for the missing details
 *   needs-review            — no guest invoice; owner alerted (starred +
 *                             labeled + notification email)
 *   (silently ignored)      — non-Wix mail that happened to match the query
 *
 * Handled-once tracking is PER MESSAGE via the log sheet's Message ID
 * column — Gmail threads Wix notifications for the same form under one
 * subject, so a thread-level marker would silently skip every repeat
 * submission of a form. The Processed label is applied to threads as a
 * visual marker only; the search never filters on it.
 */
function processInbox() {
  const processedLabel = getOrCreateLabel_(CONFIG.PROCESSED_LABEL);
  const reviewLabel = getOrCreateLabel_(CONFIG.REVIEW_LABEL);
  const handledIds = processedMessageIds_();

  const threads = GmailApp.search(CONFIG.GMAIL_QUERY);
  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      try {
        if (handledIds[message.getId()]) continue;
        if (!isWixNotification(message)) continue; // spam / non-Wix: ignore silently

        const sub = parseWixNotification(message);
        if (!sub) continue;

        handleSubmission_(sub, message, reviewLabel);
        handledIds[message.getId()] = true;
      } catch (err) {
        // Never let one bad email break the batch — flag it and move on.
        markReview_(message, reviewLabel, 'Pipeline error: ' + err.message);
        appendLog_({
          status: 'needs-review',
          notes: 'ERROR: ' + err.message,
          messageId: message.getId()
        });
        handledIds[message.getId()] = true;
      }
    }
    thread.addLabel(processedLabel);
  }
}

/** Route one parsed submission to its outcome. */
function handleSubmission_(sub, message, reviewLabel) {
  const guestName = [sub.firstName, sub.lastName].filter(Boolean).join(' ');
  const base = {
    guestName: guestName,
    email: sub.email,
    dateRequested: sub.date ? formatDateShort_(sub.date) : (sub.dateRaw || ''),
    messageId: sub.messageId
  };

  // No usable reply address → nothing we can send; owner must handle.
  if (!sub.email) {
    markReview_(message, reviewLabel, 'Submission has no guest email address.');
    appendLog_(Object.assign(base, { service: sub.formName, status: 'needs-review', notes: 'No guest email in submission' }));
    return;
  }

  // General contact-form messages get no automated reply — content is
  // unpredictable (questions, vendors, spam), so the owner answers those.
  if (isContactForm_(sub.formName)) {
    markReview_(message, reviewLabel, 'Contact form message from ' + (base.guestName || sub.email) + '.');
    appendLog_(Object.assign(base, { service: sub.formName, status: 'needs-review', notes: 'Contact form — answer personally' }));
    return;
  }

  // Duplicate guard — never double-invoice.
  if (isDuplicateSubmission_(sub)) {
    markReview_(message, reviewLabel, 'Duplicate submission from ' + sub.email + ' for ' + sub.formName + '.');
    appendLog_(Object.assign(base, { service: sub.formName, status: 'needs-review', notes: 'Duplicate submission — not re-invoiced' }));
    return;
  }

  const service = findServiceByFormName(sub.formName);

  // Unknown form → warm personal-follow-up reply + owner review.
  if (!service) {
    const email = composeFollowUpEmail(sub, null);
    const mode = deliverGuestEmail_(sub.email, email, null);
    markReview_(message, reviewLabel, 'Form "' + sub.formName + '" is not in the catalog.');
    appendLog_(Object.assign(base, {
      service: sub.formName, status: 'needs-review',
      notes: 'Not in catalog — follow-up ' + mode
    }));
    return;
  }

  // Identify the exact variant (Big Breakfast vs Sweet, 2-seater vs 4-…).
  const match = matchVariant(service, sub);
  if (!match.variant) {
    // Private Chef with no menu picked: send the menus + per-person pricing
    // for their group size instead of a bare "which option" question.
    if (service.attachMenu) {
      sendMenuOptions_(sub, service, message, reviewLabel, base);
      return;
    }
    const asks = [];
    if (match.candidates) {
      asks.push('which option you would like: ' + match.candidates.map(v => v.name).join(', '));
    } else if (service.optionAsk) {
      asks.push(service.optionAsk);
    } else {
      asks.push('which ' + service.name + ' option you would like');
    }
    if (service.askPickup && !sub.whereStaying) {
      asks.push('where you are staying, so the tour company can arrange pick-up');
    }
    sendClarification_(sub, service, asks, message, reviewLabel, base);
    return;
  }
  const variant = match.variant;

  // Missing date is always a blocker.
  const preMissing = [];
  if (!sub.date) preMissing.push('your preferred date');

  const pricing = priceSubmission(service, variant, sub);

  if (pricing.status === 'review') {
    if (variant.pricing.type === 'quote') {
      // In-catalog but unpriced (balloons, flowers, airport transfers):
      // warm follow-up — with the service's custom ask when defined
      // (e.g. "send inspiration pictures").
      const email = composeFollowUpEmail(sub, service.name.toLowerCase(), service.quoteRequest);
      const mode = deliverGuestEmail_(sub.email, email, null);
      markReview_(message, reviewLabel, service.name + ' needs a personal quote.');
      appendLog_(Object.assign(base, { service: service.name, status: 'needs-review', notes: 'Personal quote needed — follow-up ' + mode }));
    } else {
      markReview_(message, reviewLabel, service.name + ': ' + pricing.reason);
      appendLog_(Object.assign(base, { service: service.name, status: 'needs-review', notes: pricing.reason }));
    }
    return;
  }

  // Fill-in-the-price flow (airport transfers): ALWAYS a Gmail draft with a
  // $____ blank for Josh to complete — never auto-sent, even off draft mode.
  if (pricing.status === 'manualQuote') {
    const email = composeManualQuoteEmail(sub, service);
    GmailApp.createDraft(sub.email, email.subject, email.body, { name: CONFIG.BUSINESS_NAME });
    markReview_(message, reviewLabel, service.name + ': draft ready — fill in the $____ amount before sending.');
    appendLog_(Object.assign(base, {
      service: service.name,
      status: 'manual-quote-draft',
      notes: 'Draft created with blank price — fill in and send'
    }));
    return;
  }

  // Quote-and-collect-details flow (car rental): price by email, no invoice;
  // Josh confirms the booking with the vendor once the guest replies.
  if (pricing.status === 'inquire') {
    const qaInq = answerGuestQuestion_(sub, service);
    const email = composeInquiryEmail(sub, service, variant, qaInq && qaInq.text);
    const mode = deliverGuestEmail_(sub.email, email, null);
    markReview_(message, reviewLabel, service.name + ' (' + variant.name + '): price quoted, awaiting guest confirmation + booking details.');
    appendLog_(Object.assign(base, {
      service: service.name + ' — ' + variant.name,
      status: mode === 'draft' ? 'inquiry-draft' : 'inquiry-sent',
      notes: 'No-invoice flow: guest pays vendor at pickup; awaiting confirmation + booking details'
    }));
    return;
  }

  if (pricing.status === 'clarify' || preMissing.length) {
    const missing = preMissing.concat(pricing.status === 'clarify' ? pricing.missing : []);
    sendClarification_(sub, service, missing, message, reviewLabel, base);
    return;
  }

  // Fully priced → invoice + confirmation email.
  // If the guest asked a question, try to answer it: your rules first
  // (Rules.js), then an AI draft (AI.js). In auto-send mode only
  // rule-based answers may send; an AI-or-unanswered question forces a
  // human look first (it may change the request). Drafts are reviewed anyway.
  const qa = answerGuestQuestion_(sub, service);
  if (!CONFIG.DRAFT_MODE && substantiveQuestion_(sub) && (!qa || qa.source !== 'rules')) {
    markReview_(message, reviewLabel,
      'Guest asked: "' + sub.questions + '"' +
      (qa ? '\n\nAI-suggested reply (review before using):\n' + qa.text : '\n\nNo rule or AI answer available.'));
    appendLog_(Object.assign(base, { service: pricing.lineDescription, status: 'needs-review', notes: 'Guest note: ' + sub.questions }));
    return;
  }

  const invoiceNumber = nextInvoiceNumber_();
  const invoice = generateInvoice_(sub, service, variant, pricing, invoiceNumber);
  const attachments = [invoice.pdf];
  let extraLine = null;
  if (service.attachMenu) {
    const menu = menuAttachment_();
    if (menu) {
      attachments.push(menu);
      extraLine = 'You’ll find the menu attached to this email as well.';
    }
  }
  const email = composeInvoiceEmail(sub, service, variant, pricing, invoiceNumber, qa && qa.text, extraLine);
  const mode = deliverGuestEmail_(sub.email, email, attachments);

  appendLog_(Object.assign(base, {
    service: pricing.lineDescription,
    invoiceNumber: invoiceNumber,
    downpayment: pricing.downpayment,
    total: pricing.total,
    status: mode === 'draft' ? 'draft-created' : 'sent',
    notes: (sub.questions ? 'Guest note: ' + sub.questions : '') +
           (qa ? ' | answered via ' + qa.source : '')
  }));
}

function sendClarification_(sub, service, missing, message, reviewLabel, base) {
  const qa = CONFIG.DRAFT_MODE ? answerGuestQuestion_(sub, service) : null;
  const email = composeClarificationEmail(sub, service, missing, qa && qa.text);
  const mode = deliverGuestEmail_(sub.email, email, null);
  markReview_(message, reviewLabel,
    'Clarification requested from ' + (base.guestName || sub.email) + ': ' + missing.join('; ') +
    '\n\nWhat the form sent (for tuning the matcher):\n' + JSON.stringify(sub.fields, null, 2));
  appendLog_(Object.assign(base, {
    service: service ? service.name : sub.formName,
    status: mode === 'draft' ? 'clarification-draft' : 'clarification-sent',
    notes: 'Asked for: ' + missing.join('; ')
  }));
}

/** Private Chef, no menu picked: menus attached + per-person prices for their group. */
function sendMenuOptions_(sub, service, message, reviewLabel, base) {
  const lines = menuOptionLines_(service, sub.partySize);
  const menu = menuAttachment_();
  const email = composeMenuEmail(sub, service, lines, !!menu);
  const mode = deliverGuestEmail_(sub.email, email, menu ? [menu] : null);
  markReview_(message, reviewLabel,
    service.name + ': menu options ' + (mode === 'draft' ? 'drafted' : 'sent') + ' — guest picking a menu.' +
    '\n\nWhat the form sent (for tuning the matcher):\n' + JSON.stringify(sub.fields, null, 2));
  appendLog_(Object.assign(base, {
    service: service.name,
    status: mode === 'draft' ? 'menu-options-draft' : 'menu-options-sent',
    notes: 'Menu choice pending' + (sub.partySize ? ' (party of ' + sub.partySize + ')' : ' (party size unknown)')
  }));
}

/**
 * Per-person price lines for every menu available at the given party size,
 * e.g. "Brunch — $70 per person". Empty when party size is unknown.
 */
function menuOptionLines_(service, partySize) {
  if (partySize == null) return [];
  const lines = [];
  for (const v of service.variants) {
    const p = v.pricing;
    let price = null;
    if (p.type === 'tieredPerPerson') {
      const tier = p.tiers.find(t => partySize >= t.min && partySize <= t.max);
      if (tier) price = tier.price;
    } else if (p.type === 'perPerson' && (!p.minPeople || partySize >= p.minPeople)) {
      price = p.price;
    }
    if (price != null) {
      lines.push(v.name.replace(/^Private Chef — /, '') + ' — ' + money_(price) + ' per person');
    }
  }
  return lines;
}

/** Star + label the original email and alert the owner. */
function markReview_(message, reviewLabel, reason) {
  try {
    message.star();
    message.getThread().addLabel(reviewLabel);
  } catch (e) { /* labeling is best-effort */ }
  notifyOwner_('Needs review: ' + (message.getSubject() || '(no subject)'),
    reason + '\n\nOpen the original email (starred, label ' + CONFIG.REVIEW_LABEL + ') to act on it.');
}

/** The chef menu PDF from Drive, when configured; null otherwise. */
function menuAttachment_() {
  try {
    const id = getProp_('CHEF_MENU_FILE_ID') || CONFIG.CHEF_MENU_FILE_ID;
    if (!id) return null;
    return DriveApp.getFileById(id).getBlob();
  } catch (e) {
    Logger.log('Menu attachment skipped — %s', e.message);
    return null;
  }
}

function isContactForm_(formName) {
  const f = String(formName || '').toLowerCase();
  return CONFIG.CONTACT_FORMS.some(c => f === c.toLowerCase()) || f.indexOf('contact') !== -1;
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** Install the time-driven trigger (runs processInbox every 5 minutes). */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processInbox')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(5).create();
}
