/**
 * One-time setup. Run setup() once from the Apps Script editor after pasting
 * the project in; it provisions everything and prints what it created.
 *
 * Resources are remembered in Script Properties, so re-running setup() is
 * safe — it only creates what is missing.
 */
function setup() {
  // Gmail labels
  getOrCreateLabel_(CONFIG.PROCESSED_LABEL);
  getOrCreateLabel_(CONFIG.REVIEW_LABEL);

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

  s.setColumnWidths(1, 6, 120);
  s.setColumnWidth(1, 220);

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
  s.getRange('D16:F18').setNumberFormat('$#,##0.00');
  s.getRange('D20:F20').setNumberFormat('$#,##0.00').setFontWeight('bold');

  s.getRange('A23').setValue('Notes:').setFontWeight('bold');
  CONFIG.INVOICE_NOTES.forEach((note, i) => s.getRange('A' + (24 + i)).setValue(note));

  return ss.getId();
}
