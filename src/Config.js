/**
 * Aqua Lux Aruba — inquiry pipeline configuration.
 *
 * DRAFT_MODE is the master safety switch. While true, every guest-facing
 * email is created as a Gmail DRAFT for your approval and nothing is sent
 * automatically. Flip to false only after you have reviewed real drafts
 * and are happy with them.
 */
const CONFIG = {
  DRAFT_MODE: true,

  BUSINESS_NAME: 'Aqua Lux Aruba',
  WEBSITE: 'aqualuxaruba.com',
  OWNER_EMAIL: 'aqualuxaruba@gmail.com',

  // Google Sheet ID of your "Aqua Lux Concierge Invoice" template.
  // Leave blank to have setup() generate a starter template that matches
  // the INVOICE_CELLS map below; replace with your branded sheet's ID and
  // adjust INVOICE_CELLS if your layout differs.
  INVOICE_TEMPLATE_ID: '',

  // Log spreadsheet + Drive folder for generated invoices.
  // Leave blank; setup() creates them and stores the IDs in Script Properties.
  LOG_SPREADSHEET_ID: '',
  INVOICE_FOLDER_ID: '',

  // Gmail
  PROCESSED_LABEL: 'AquaLux/Processed',
  REVIEW_LABEL: 'AquaLux/Needs-Review',
  // Only messages matching this query are even considered; the parser then
  // additionally requires the Wix body signature and a Wix sender domain.
  GMAIL_QUERY: '"A site visitor just submitted your form" newer_than:7d',
  WIX_SENDER_PATTERNS: ['wix.com', 'wix-forms.com', 'wixforms.com', 'wixanswers.com'],

  // Forms that are general contact/messages, not service bookings: no
  // automatic guest reply — just flag for the owner to answer personally.
  CONTACT_FORMS: ['Contact', 'Contact Form'],

  // Drive file ID of the Private Chef menu PDF. When set, chef confirmation
  // emails attach the menu and mention it. Can also be set as a Script
  // Property named CHEF_MENU_FILE_ID.
  CHEF_MENU_FILE_ID: '',

  // Email the owner whenever something is flagged needs-review.
  NOTIFY_OWNER_ON_REVIEW: true,

  // AI-drafted answers to guest questions not covered by Rules.js.
  // Requires the ANTHROPIC_API_KEY script property. AI answers appear only
  // in drafts (for your review) or in owner alerts — never auto-sent.
  AI_ANSWERS_ENABLED: true,

  // Invoice numbering: AQL-<year>-<zero-padded counter>, e.g. AQL-2026-0001.
  INVOICE_PREFIX: 'AQL',
  INVOICE_PAD: 4,

  // A second submission from the same email + same form + same requested
  // date within this window is treated as a duplicate (flagged, not invoiced).
  DUPLICATE_WINDOW_DAYS: 30,

  PAYMENT_OPTIONS: [
    'Zelle: aqualuxaruba@gmail.com',
    'Venmo: @AquaLuxAruba',
    'Bank Transfer (Aruba): Joshua Saladin, account 3106380190, Aruba Bank'
  ],

  CANCELLATION_POLICY:
    'Cancellations more than two weeks before your service date receive a full refund. ' +
    'Cancellations within two weeks of the service date are non-refundable.',

  INVOICE_NOTES: [
    'Downpayment is required for reservation',
    'Cancellation prior to 2 weeks - Full Refund',
    'Cancellation within 2 weeks of service - No Refund',
    'Remaining balance needs to be paid to service provider'
  ],

  // Cell map for filling the invoice template. Matches the sheet produced by
  // createInvoiceTemplate(); edit these if you plug in your own branded sheet.
  INVOICE_CELLS: {
    invoiceNumber: 'B4',
    invoiceDate: 'E4',
    guestName: 'B7',
    guestAddress: 'B8',
    lineItemStartRow: 16, // Description | Date | People | Downpayment | Remaining | Total => cols A-F
    totalsDownpayment: 'D20',
    totalsRemaining: 'E20',
    totalsTotal: 'F20'
  },

  TIMEZONE: 'America/Aruba'
};
