/**
 * Invoice generation: duplicate the branded template sheet, fill it in,
 * export to PDF, park the copy in the invoices Drive folder.
 */

/**
 * Create a filled invoice and return { pdf, fileId, invoiceNumber }.
 * Every value written to the sheet passes the leak guard first.
 */
function generateInvoice_(sub, service, variant, pricing, invoiceNumber) {
  const templateId = getProp_('INVOICE_TEMPLATE_ID') || CONFIG.INVOICE_TEMPLATE_ID;
  if (!templateId) throw new Error('INVOICE_TEMPLATE_ID is not configured — run setup() first.');

  const folder = DriveApp.getFolderById(getProp_('INVOICE_FOLDER_ID') || CONFIG.INVOICE_FOLDER_ID);
  const guestName = [sub.firstName, sub.lastName].filter(Boolean).join(' ') || 'Guest';
  const copyName = invoiceNumber + ' — ' + guestName + ' — ' + pricing.lineDescription;

  const copy = DriveApp.getFileById(templateId).makeCopy(copyName, folder);
  const ss = SpreadsheetApp.openById(copy.getId());
  const sheet = ss.getSheets()[0];
  const cells = CONFIG.INVOICE_CELLS;

  const address = guestLocation_(sub) || '';
  const dateShort = sub.date ? formatDateShort_(sub.date) : '';

  const values = {
    invoiceNumber: invoiceNumber,
    invoiceDate: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'MM/dd/yyyy'),
    guestName: guestName,
    guestAddress: address
  };
  for (const key of Object.keys(values)) {
    assertGuestSafe_(values[key], 'invoice field ' + key);
    sheet.getRange(cells[key]).setValue(values[key]);
  }

  // Line item: Description | Date | People | Downpayment | Remaining | Total
  assertGuestSafe_(pricing.lineDescription, 'invoice line description');
  const row = cells.lineItemStartRow;
  sheet.getRange(row, 1, 1, 6).setValues([[
    pricing.lineDescription, dateShort, pricing.peopleDisplay || '',
    pricing.downpayment, pricing.remaining, pricing.total
  ]]);

  sheet.getRange(cells.totalsDownpayment).setValue(pricing.downpayment);
  sheet.getRange(cells.totalsRemaining).setValue(pricing.remaining);
  sheet.getRange(cells.totalsTotal).setValue(pricing.total);

  SpreadsheetApp.flush();

  const pdf = exportSheetPdf_(copy.getId(), invoiceNumber + ' - Aqua Lux Aruba Invoice.pdf');
  return { pdf: pdf, fileId: copy.getId(), invoiceNumber: invoiceNumber };
}

/** Export a spreadsheet as a clean, letter-sized, gridline-free PDF blob. */
function exportSheetPdf_(spreadsheetId, filename) {
  const url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export' +
    '?format=pdf&size=letter&portrait=true&fitw=true&gridlines=false' +
    '&printtitle=false&sheetnames=false&pagenum=UNDEFINED&top_margin=0.5&bottom_margin=0.5' +
    '&left_margin=0.5&right_margin=0.5';
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  });
  return resp.getBlob().setName(filename);
}

/**
 * Next invoice number, safe for unattended sequential use.
 * Format AQL-<year>-<0001…>; the counter lives in Script Properties and is
 * incremented under a script lock so concurrent trigger runs can't collide.
 * The counter resets each year via the year-scoped property key.
 */
function nextInvoiceNumber_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const year = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy');
    const key = 'INVOICE_COUNTER_' + year;
    const props = PropertiesService.getScriptProperties();
    const next = parseInt(props.getProperty(key) || '0', 10) + 1;
    props.setProperty(key, String(next));
    return CONFIG.INVOICE_PREFIX + '-' + year + '-' + padLeft_(next, CONFIG.INVOICE_PAD);
  } finally {
    lock.releaseLock();
  }
}

function padLeft_(n, width) {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function getProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}
