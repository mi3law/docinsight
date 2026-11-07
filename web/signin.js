// Google sign-in for the one-link mode: loads Google Identity Services on demand and keeps a short-lived read-only
// token in memory only (never stored, logged, shown or put in an address). Same pattern as CensorSearch's sign-in.
const GIS_URL = 'https://accounts.google.com/gsi/client';
const EARLY = 60 * 1000;

const MSG = {
  load: "Google sign-in didn't load: a network filter or browser extension may block accounts.google.com.",
  popup_failed_to_open: "The browser blocked Google's sign-in window. Allow pop-ups for this page, then try again.",
  popup_closed: 'The sign-in window closed before signing in finished.',
  access_denied: "Google sign-in was cancelled, or the school's Google settings don't allow this page.",
  admin_policy_enforced: "The school's Google settings don't let this page read Google Docs. Ask the school's IT to allow it.",
  org_internal: "Only the school's Google accounts can sign in here. Sign in with your school account.",
  scope: "Your Google sign-in didn't give this page permission to read the document. Sign in again and allow it.",
  failed: "Google sign-in didn't work. Try again.",
};
export const signInMessage = code => MSG[code] || MSG.failed;

let loading = null;
export function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_URL; s.async = true;
    const timer = setTimeout(() => { loading = null; reject(Object.assign(new Error(MSG.load), { code: 'load' })); }, 20000);
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => { clearTimeout(timer); loading = null; reject(Object.assign(new Error(MSG.load), { code: 'load' })); };
    document.head.append(s);
  });
  return loading;
}

export function createSignIn(clientId, scope) {
  let client = null, pending = null, token = null, expiresAt = 0;
  const settle = r => {
    const p = pending; pending = null;
    if (!p) return;
    if (!r || r.error || !r.access_token) { p.reject(Object.assign(new Error(signInMessage(r && r.error)), { code: r && r.error })); return; }
    if (!google.accounts.oauth2.hasGrantedAllScopes(r, scope)) { p.reject(Object.assign(new Error(MSG.scope), { code: 'scope' })); return; }
    token = r.access_token;
    expiresAt = Date.now() + (Number(r.expires_in) > 0 ? Number(r.expires_in) : 3600) * 1000;
    p.resolve();
  };
  return {
    // Call straight from a click, before any await, so the browser allows Google's window.
    signIn(chooseAccount) {
      return new Promise((resolve, reject) => {
        if (!(window.google && google.accounts && google.accounts.oauth2)) { reject(Object.assign(new Error(MSG.load), { code: 'load' })); return; }
        pending = { resolve, reject };
        if (!client) client = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope, callback: settle, error_callback: e => settle({ error: (e && e.type) || 'failed' }) });
        client.requestAccessToken({ prompt: chooseAccount ? 'select_account' : '' });
      });
    },
    token: () => (token && Date.now() < expiresAt - EARLY ? token : null),
    forget() { token = null; expiresAt = 0; },
  };
}
