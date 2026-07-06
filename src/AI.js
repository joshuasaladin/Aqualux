/**
 * AI answers for guest questions that no rule in Rules.js covers.
 *
 * Uses the Claude API (claude-opus-4-8) with web search enabled, under a
 * strict system prompt: no prices, no availability promises, no vendor or
 * internal information, defer to Joshua when unsure. Every AI answer also
 * passes the leak guard before it is used.
 *
 * SAFETY: AI answers are only ever placed in DRAFTS for your review, or
 * shown to you inside a needs-review alert. They are never auto-sent to a
 * guest, even after DRAFT_MODE is turned off.
 *
 * Setup: in Apps Script, Project Settings → Script Properties → add
 *   ANTHROPIC_API_KEY = <your key from console.anthropic.com>
 * Without the key (or with AI_ANSWERS_ENABLED false) this feature simply
 * stays off and questions are flagged for you as before.
 */

const AI_SYSTEM_PROMPT =
'You draft short answers to guest questions for Aqua Lux Aruba, a luxury concierge service for tourists in Aruba (aqualuxaruba.com). ' +
'Rules you must never break:\n' +
'- Never state or estimate prices, discounts, or availability. Booking specifics are confirmed separately.\n' +
'- Never mention supplier or vendor companies, commissions, or how services are sourced. Speak only as Aqua Lux Aruba.\n' +
'- The emails are written in the owner’s first-person voice: write as "I" / "we", never "Joshua will…". If the question needs a decision or fact only the owner can give, say "I will confirm that detail for you personally."\n' +
'- General Aruba facts (weather, geography, customs, what to bring, typical timing of sunset, etc.) are fine; use web search when it helps you be accurate.\n' +
'Style: warm, polished, personal luxury-concierge voice. 1–3 sentences of plain text. No markdown, no lists, no greetings or sign-offs — your text is inserted into an email that already has them.';

/**
 * Ask Claude to draft an answer to the guest's question.
 * Returns the answer text, or null when AI answering is off, unavailable,
 * unsafe, or Claude declined.
 */
function aiAnswer_(question, sub, service) {
  try {
    if (!CONFIG.AI_ANSWERS_ENABLED || !question) return null;
    const apiKey = getProp_('ANTHROPIC_API_KEY');
    if (!apiKey) return null;

    const context =
      'Guest question (from a booking inquiry form): "' + question + '"\n' +
      (service ? 'The inquiry is about our service: ' + service.name + ' — ' + service.description + '\n' : '') +
      (sub.date ? 'Requested date: ' + formatDateDisplay_(sub.date) + '\n' : '') +
      'Draft the answer text only.';

    const payload = {
      model: 'claude-opus-4-8',
      max_tokens: 3000,
      thinking: { type: 'adaptive' },
      system: AI_SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: context }]
    };

    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      Logger.log('AI answer skipped — API returned %s: %s', response.getResponseCode(), response.getContentText());
      return null;
    }

    const data = JSON.parse(response.getContentText());
    if (data.stop_reason === 'refusal' || data.stop_reason === 'pause_turn') return null;

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return null;

    assertGuestSafe_(text, 'AI answer'); // throws on internal terms → caught below
    return text;
  } catch (err) {
    Logger.log('AI answer skipped — %s', err.message);
    return null;
  }
}

/**
 * Best available answer to the guest's question:
 *   1. your rules (Rules.js) — always win, safe to send;
 *   2. AI draft — draft/review only;
 *   3. null — nothing available, flag as before.
 * Returns { text, source: 'rules' | 'ai' } or null.
 */
function answerGuestQuestion_(sub, service) {
  const question = substantiveQuestion_(sub);
  if (!question) return null;
  const ruleAnswers = findRuleAnswers_(question);
  if (ruleAnswers.length) return { text: ruleAnswers.join(' '), source: 'rules' };
  const ai = aiAnswer_(question, sub, service);
  if (ai) return { text: ai, source: 'ai' };
  return null;
}

/**
 * The guest's free-text note, unless it is merely their address (which
 * guestLocation_ already consumes when "Where are you staying?" = Other).
 */
function substantiveQuestion_(sub) {
  if (!sub.questions) return null;
  if ((sub.whereStaying || '').toLowerCase() === 'other' && sub.questions.length <= 80) return null;
  return sub.questions;
}
