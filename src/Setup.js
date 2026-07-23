/**
 * One-time setup. Run setup() once from the Apps Script editor after pasting
 * the project in; it provisions everything and prints what it created.
 *
 * Resources are remembered in Script Properties, so re-running setup() is
 * safe — it only creates what is missing.
 */
/**
 * One-time cleanup: deletes the AquaLux/Processed and AquaLux/Needs-Review
 * Gmail labels left over from an earlier version of this pipeline. Only
 * removes the label definitions — the emails themselves are untouched.
 * Safe to run more than once; does nothing once the labels are gone.
 */
function removeOldLabels() {
  ['AquaLux/Processed', 'AquaLux/Needs-Review'].forEach(name => {
    const label = GmailApp.getUserLabelByName(name);
    if (label) {
      label.deleteLabel();
      Logger.log('Deleted label: %s', name);
    } else {
      Logger.log('Label not found (already removed): %s', name);
    }
  });
}

function setup() {
  // Invoice folder
  let folderId = getProp_('INVOICE_FOLDER_ID') || CONFIG.INVOICE_FOLDER_ID;
  if (!folderId) {
    folderId = DriveApp.createFolder('Aqua Lux Invoices').getId();
    setProp_('INVOICE_FOLDER_ID', folderId);
  }

  // Log spreadsheet
  let logId = getProp_('LOG_SPREADSHEET_ID') || CONFIG.LOG_SPREADSHEET_ID;
  if (!logId) {
    const ss = SpreadsheetApp.create('Aqua Lux Pipeline Log');
    ss.getSheets()[0].setName('Log');
    logId = ss.getId();
    setProp_('LOG_SPREADSHEET_ID', logId);
  }
  getLogSheet_(); // writes the header row

  // Invoice template: use yours if configured, otherwise generate a starter
  // that matches CONFIG.INVOICE_CELLS exactly.
  let templateId = getProp_('INVOICE_TEMPLATE_ID') || CONFIG.INVOICE_TEMPLATE_ID;
  if (!templateId) {
    templateId = createInvoiceTemplate();
    setProp_('INVOICE_TEMPLATE_ID', templateId);
  } else {
    setProp_('INVOICE_TEMPLATE_ID', templateId);
  }

  Logger.log('Setup complete.');
  Logger.log('Invoice template: https://docs.google.com/spreadsheets/d/' + templateId);
  Logger.log('Pipeline log:     https://docs.google.com/spreadsheets/d/' + logId);
  Logger.log('Invoice folder:   https://drive.google.com/drive/folders/' + folderId);
  Logger.log('Next: run testSampleSubmission() for the dry run, then installTrigger() to go live in draft mode.');
}

/**
 * Generate a starter invoice template matching CONFIG.INVOICE_CELLS.
 * Swap in your own branded sheet later by setting the INVOICE_TEMPLATE_ID
 * script property (and adjusting INVOICE_CELLS if the layout differs).
 * To add your logo: Insert → Image → Image in cell, at C1.
 */
function createInvoiceTemplate() {
  const ss = SpreadsheetApp.create('Aqua Lux Concierge Invoice — TEMPLATE');
  const s = ss.getSheets()[0].setName('Invoice');

  s.getRange('A1').setValue(CONFIG.BUSINESS_NAME).setFontSize(22).setFontWeight('bold');
  s.getRange('A2').setValue('Invoice').setFontSize(14).setFontStyle('italic');

  s.getRange('A4').setValue('Invoice #:').setFontWeight('bold');
  s.getRange('D4').setValue('Date:').setFontWeight('bold');

  s.getRange('A6').setValue('Invoice for:').setFontWeight('bold');
  s.getRange('A7').setValue('Name:');
  s.getRange('A8').setValue('Address:');

  s.getRange('A10').setValue('Payable to:').setFontWeight('bold');
  s.getRange('A11').setValue('Zelle: aqualuxaruba@gmail.com');
  s.getRange('A12').setValue('Venmo: @AquaLuxAruba');
  s.getRange('A13').setValue('Bank Transfer Aruba: Joshua Saladin, 3106380190, Aruba Bank');

  s.getRange('A15:F15')
    .setValues([['Description', 'Date', 'People', 'Downpayment', 'Remaining Balance', 'Total']])
    .setFontWeight('bold').setBackground('#0b3d5c').setFontColor('#ffffff');

  s.getRange('A20').setValue('Totals').setFontWeight('bold');
  s.getRange('D19:F19').setValues([['Downpayment', 'Remaining balance', 'Total']]).setFontWeight('bold');

  s.getRange('A23').setValue('Notes:').setFontWeight('bold');
  CONFIG.INVOICE_NOTES.forEach((note, i) => s.getRange('A' + (24 + i)).setValue(note));

  applyInvoiceLayout_(s);
  return ss.getId();
}

/**
 * Fix the layout of your EXISTING invoice template (run once): wraps the
 * description so long service names read fully on extra lines, widens the
 * money columns, and stops "Remaining Balance" and "Total" overlapping.
 */
function fixInvoiceTemplate() {
  const id = getProp_('INVOICE_TEMPLATE_ID') || CONFIG.INVOICE_TEMPLATE_ID;
  if (!id) throw new Error('No invoice template configured — run setup() first.');
  applyInvoiceLayout_(SpreadsheetApp.openById(id).getSheets()[0]);
  Logger.log('Template layout fixed ✓  https://docs.google.com/spreadsheets/d/' + id);
  Logger.log('Run testSampleSubmission() to see a fresh PDF with the new layout.');
}

/** Column widths, wrapping, and alignment shared by create + fix. */
function applyInvoiceLayout_(s) {
  s.setColumnWidth(1, 270); // Description — wide, wraps to extra lines
  s.setColumnWidth(2, 90);  // Date
  s.setColumnWidth(3, 65);  // People
  s.setColumnWidth(4, 115); // Downpayment
  s.setColumnWidth(5, 125); // Remaining Balance
  s.setColumnWidth(6, 95);  // Total

  // Table header: wrap so "Remaining Balance" stacks instead of spilling
  // into "Total"; numbers right-aligned under their headers.
  s.getRange('A15:F15').setWrap(true).setVerticalAlignment('middle');
  s.setRowHeight(15, 40);
  s.getRange('D15:F15').setHorizontalAlignment('right');
  s.getRange('B15:C15').setHorizontalAlignment('center');

  // Line items: description wraps (rows auto-grow); dates/people centered,
  // money right-aligned. NOTE: no fixed row heights here — auto-height is
  // what lets wrapped descriptions expand.
  s.getRange('A16:A18').setWrap(true).setVerticalAlignment('top');
  s.getRange('B16:C18').setHorizontalAlignment('center');
  s.getRange('D16:F18').setHorizontalAlignment('right').setNumberFormat('$#,##0.00');

  // Totals block: labels wrap and sit right-aligned above their amounts.
  s.getRange('D19:F19').setWrap(true).setHorizontalAlignment('right').setVerticalAlignment('bottom');
  s.getRange('D20:F20').setHorizontalAlignment('right').setNumberFormat('$#,##0.00').setFontWeight('bold');
}
