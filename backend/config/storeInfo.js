// Business identity printed on every receipt and Z-Reading report. Hardcoded-with-env-override
// by design (see deployment.md Phase 1 / the Z-Reading feature discussion) — these rarely change,
// so a small config module beats a full admin settings screen for now.
//
// STORE_SN (the machine/POS serial number BIR printouts require) has no safe default — it MUST
// be set in backend/.env before this is used for anything with real compliance weight.
//
// The posProvider* / ptu* fields are the BIR "Permit To Use" accreditation block that identifies
// whoever supplied the POS software/terminal (not AIMS itself, and not this store) — they're
// placeholders copied from the sample receipt's format. Like STORE_SN, these carry real legal
// weight on an official receipt and MUST be replaced with the store's actual accreditation before
// this is used for anything but internal/demo printing.

const STORE_INFO = {
  name: process.env.STORE_NAME || 'ASKI MULTI-PURPOSE COOPERATIVE',
  tin: process.env.STORE_TIN || '295-473-553-000 NON VAT',
  sn: process.env.STORE_SN || 'REPLACE-WITH-SN',
  addressLine1: process.env.STORE_ADDRESS_LINE1 || '#135 Barangay Andal Aliano',
  addressLine2: process.env.STORE_ADDRESS_LINE2 || 'Talavera, Nueva Ecija',
  terminalNo: process.env.STORE_TERMINAL_NO || '001',

  posProviderName: process.env.POS_PROVIDER_NAME || 'REPLACE-WITH-POS-PROVIDER',
  posProviderAddress: process.env.POS_PROVIDER_ADDRESS || 'REPLACE-WITH-POS-PROVIDER-ADDRESS',
  posProviderVatTin: process.env.POS_PROVIDER_VAT_TIN || 'REPLACE-WITH-PROVIDER-TIN',
  posProviderAccr: process.env.POS_PROVIDER_ACCR || 'REPLACE-WITH-ACCR-NO',
  ptuDate: process.env.POS_PTU_DATE || 'REPLACE-WITH-PTU-DATE',
  ptuValidUntil: process.env.POS_PTU_VALID_UNTIL || 'REPLACE-WITH-PTU-VALID-UNTIL',
  ptum: process.env.POS_PTUM || 'REPLACE-WITH-PTUM',
};

module.exports = { STORE_INFO };
