/**
 * Pipeline log: one row per processed submission in the "Aqua Lux Pipeline
 * Log" spreadsheet. Also serves as the duplicate-detection and
 * already-processed record, so the pipeline never depends on Gmail labels
 * alone.
 */
const LOG_HEADERS = [
  'Timestamp', 'Guest Name', 'Email', 'Service', 'Date Requested',
  'Invoice #', 'Downpayment', 'Total', 'Status', 'Notes', 'Message ID'
];

function getLogSheet_() {
  const id = getProp_('LOG_SPREADSHEET_ID') || CONFIG.LOG_SPREADSHEET_ID;
  if (!id) throw new Error('LOG_SPREADSHEET_ID is not configured — run setup() first.');
  const ss = SpreadsheetApp.openById(id);
  let sheet = ss.getSheetByName('Log') || ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(LOG_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendLog_(entry) {
  getLogSheet_().appendRow([
    new Date(),
    entry.guestName || '',
    entry.email || '',
    entry.service || '',
    entry.dateRequested || '',
    entry.invoiceNumber || '',
    entry.downpayment != null ? entry.downpayment : '',
    entry.total != null ? entry.total : '',
    entry.status,
    entry.notes || '',
    entry.messageId || ''
  ]);
}

/** True if this exact Gmail message was already logged (idempotency). */
function alreadyProcessed_(messageId) {
  return logRows_().some(r => r[10] === messageId);
}

/** All logged Message IDs as a lookup map — read once per pipeline run. */
function processedMessageIds_() {
  const ids = {};
  logRows_().forEach(r => { if (r[10]) ids[r[10]] = true; });
  return ids;
}

/**
 * True if the same guest email + form/service + requested date was already
 * handled within the duplicate window — don't double-invoice.
 */
function isDuplicateSubmission_(sub) {
  if (!sub.email) return false;
  const cutoff = Date.now() - CONFIG.DUPLICATE_WINDOW_DAYS * 86400000;
  const date = sub.date ? formatDateShort_(sub.date) : '';
  return logRows_().some(r => {
    const ts = r[0] instanceof Date ? r[0].getTime() : Date.parse(r[0]);
    if (!(ts > cutoff)) return false;
    if (String(r[2]).toLowerCase() !== sub.email) return false;
    const svc = String(r[3]).toLowerCase();
    const form = (sub.formName || '').toLowerCase();
    if (!svc || !form || (svc.indexOf(form) === -1 && form.indexOf(svc) === -1)) return false;
    const loggedDate = r[4] instanceof Date ? formatDateShort_(r[4]) : String(r[4]);
    return !date || !loggedDate || loggedDate === date;
  });
}

function logRows_() {
  const sheet = getLogSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, LOG_HEADERS.length).getValues();
}
