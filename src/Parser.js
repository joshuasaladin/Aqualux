/**
 * Parser for Wix form-notification emails.
 *
 * Expected shape (plain-text body):
 *   A site visitor just submitted your form <FORM NAME> on Aqua Lux Aruba
 *   ...
 *   Submission summary:
 *   First name:
 *   Michele
 *   Last name:
 *   Defilippis
 *   ...
 *
 * Parses defensively: every field is optional, unknown labels are kept in
 * `fields` untouched, and anything unparseable simply comes back missing so
 * the router can ask for clarification instead of guessing.
 */

/** Labels that mark the end of the submission summary block. */
const PARSER_STOP_LINES = ['view submissions', 'view submission', 'unsubscribe', 'this email was sent'];

/** Returns true when the message really is a Wix form notification. */
function isWixNotification(message) {
  const from = (message.getFrom() || '').toLowerCase();
  const fromWix = CONFIG.WIX_SENDER_PATTERNS.some(p => from.indexOf(p) !== -1);
  const body = message.getPlainBody() || '';
  const hasSignature = /a site visitor just submitted your form/i.test(body);
  return fromWix && hasSignature;
}

/**
 * Parse a Wix notification message into a submission object.
 * Returns null when the body doesn't carry the Wix signature.
 */
function parseWixNotification(message) {
  const body = message.getPlainBody() || '';

  const formMatch = body.match(/a site visitor just submitted your form\s+(.+?)\s+on\s+aqua\s?lux\s?aruba/i);
  if (!formMatch) return null;
  const formName = collapseWhitespace_(formMatch[1]);

  const fields = parseSummaryFields_(body);

  const sub = {
    messageId: message.getId(),
    receivedAt: message.getDate(),
    formName: formName,
    fields: fields,
    firstName: pickField_(fields, ['first name']),
    lastName: pickField_(fields, ['last name']),
    email: cleanEmail_(pickField_(fields, ['email', 'e-mail'])),
    dateRaw: pickField_(fields, ['select a date', 'date', 'preferred date']),
    timeRaw: pickField_(fields, ['select a time', 'time', 'preferred time']),
    whereStaying: pickField_(fields, ['where are you staying', 'staying', 'resort', 'accommodation']),
    questions: pickField_(fields, ['any questions', 'questions', 'comments', 'special requests'])
  };

  sub.partyBreakdown = extractPartyBreakdown_(fields);
  sub.partySize = sub.partyBreakdown.total;
  sub.hours = extractNumberField_(fields, ['hours', 'how many hours', 'duration']);
  sub.date = parseDate_(sub.dateRaw);
  sub.timeDisplay = formatTime_(sub.timeRaw);

  return sub;
}

/** Parse the "Submission summary:" label/value block into a plain object. */
function parseSummaryFields_(body) {
  const fields = {};
  const summaryIdx = body.search(/submission summary\s*:/i);
  const text = summaryIdx >= 0 ? body.slice(summaryIdx) : body;
  const lines = text.split(/\r?\n/).map(l => collapseWhitespace_(l));

  let currentLabel = null;
  let currentValue = [];
  const flush = () => {
    if (currentLabel) fields[currentLabel] = currentValue.join(' ').trim();
    currentLabel = null;
    currentValue = [];
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const lower = line.toLowerCase();
    if (PARSER_STOP_LINES.some(s => lower.indexOf(s) !== -1)) break;

    // A label is a reasonably short line ending in ':' (values rarely do).
    if (/^.{1,80}:$/.test(line)) {
      flush();
      currentLabel = line.slice(0, -1).trim();
    } else if (/^[^:]{1,60}:\s+\S/.test(line) && !currentLabel) {
      // Inline "Label: value" form, just in case Wix changes format.
      const idx = line.indexOf(':');
      fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    } else if (currentLabel) {
      currentValue.push(line);
    }
  }
  flush();
  return fields;
}

/** Case-insensitive lookup of the first field whose label contains a key. */
function pickField_(fields, keys) {
  for (const label of Object.keys(fields)) {
    const l = label.toLowerCase();
    if (keys.some(k => l.indexOf(k) !== -1)) {
      const v = fields[label];
      if (v) return v;
    }
  }
  return null;
}

/** Extract adults / children / total party size from whatever fields exist. */
function extractPartyBreakdown_(fields) {
  const adults = extractNumberField_(fields, ['adults', 'number of adults', 'how many adults']);
  const children = extractNumberField_(fields, ['children', 'kids', 'number of children']);
  let total = extractNumberField_(fields, ['how many people', 'number of people', 'people', 'guests', 'party size', 'group size', 'persons']);
  if (total == null && (adults != null || children != null)) {
    total = (adults || 0) + (children || 0);
  }
  return { adults: adults, children: children, total: total };
}

/** Find a numeric value in a field whose label matches one of the keys. */
function extractNumberField_(fields, keys) {
  const raw = pickField_(fields, keys);
  if (!raw) return null;
  const m = String(raw).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Parse a submitted date string; supports yyyy-MM-dd and common variants. */
function parseDate_(raw) {
  if (!raw) return null;
  const iso = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const us = String(raw).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return new Date(+us[3], +us[1] - 1, +us[2]);
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** "08:30" → "8:30 AM"; passes through anything it can't parse. */
function formatTime_(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(raw);
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + min + ' ' + ampm;
}

function formatDateDisplay_(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'EEEE, MMMM d, yyyy');
}

function formatDateShort_(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'MM/dd/yyyy');
}

function cleanEmail_(raw) {
  if (!raw) return null;
  const m = String(raw).match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0].toLowerCase() : null;
}

function collapseWhitespace_(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
