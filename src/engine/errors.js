// DocInsight errors: every failure the interface can show has a code, a plain sentence for the teacher and, when Google
// answered, the raw HTTP status for a bug report. The fetch and parse layers are the only code that raises these.

export const MESSAGES = Object.freeze({
  'no-access': 'You need edit access to this document to see its history.',
  'not-a-doc': 'This file has no Google Docs history.',
  'not-found': 'Google could not find this document. Check the link, or that you are signed in with the right account.',
  'signed-out': 'Google did not recognise your sign-in. Sign in to Google again, then reload the document.',
  'changed': 'Google changed something; DocInsight needs an update.',
  'network': 'Google could not be reached. Check the connection and try again.',
  'cancelled': 'Loading was cancelled.',
  'empty': 'This document has no history beyond its starting text.',
  'too-big': 'This record is too large to open here.',
  'bad-record': 'This file is not a DocInsight record.',
});

export class DocInsightError extends Error {
  constructor(code, detail = {}) {
    super(MESSAGES[code] || MESSAGES.changed);
    this.name = 'DocInsightError';
    this.code = MESSAGES[code] ? code : 'changed';
    if (detail.status != null) this.status = detail.status;
    if (detail.where) this.where = detail.where;
    if (detail.info) this.info = String(detail.info).slice(0, 300);
  }
  // What a bug report needs, with nothing from the document in it.
  report() {
    return [this.code, this.where, this.status != null ? 'HTTP ' + this.status : '', this.info].filter(Boolean).join(' · ');
  }
}

export const isDocInsightError = e => !!e && e.name === 'DocInsightError';
