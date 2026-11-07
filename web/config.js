// DocInsight web page settings: the only file to edit for another school.
export const CONFIG = {
  // The Google sign-in client (an Internal OAuth client in the school's Google Cloud project; public, not a secret).
  // This is the school's CensorSearch client, whose consent screen is named "CensorSearch"; a client of DocInsight's own
  // can replace it (README, "The one-link web page"). Its Authorized JavaScript origins must include this page's origin.
  googleClientId: '640659635830-rthmbg5fvne57fgv39rk508q62qm6hgp.apps.googleusercontent.com',
  // The permission the one-link mode asks for. drive.readonly is the scope the spike proved on 7 November 2026.
  scope: 'https://www.googleapis.com/auth/drive.readonly',
  repoUrl: 'https://github.com/mi3law/docinsight',
};
