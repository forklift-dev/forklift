/** A saved username/password for an HTTPS remote, as Preferences lists it (never the password). */
export interface SavedCredential {
  id: string;
  protocol: string;
  host: string;
  /** Set when git distinguishes repositories on one host (credential.useHttpPath). */
  path: string;
  username: string;
}
