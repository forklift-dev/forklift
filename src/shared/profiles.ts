// Profiles: a commit identity with its SSH key and signing setup, applied to git config globally or for
// one repository. Keys are referred to by path or id; passphrases are never stored.

export type SigningFormat = 'none' | 'openpgp' | 'ssh';

export interface Profile {
  id: string;
  /** Shown in the switcher, e.g. "Work". */
  label: string;
  userName: string;
  email: string;
  /** Private key used for ssh remotes (core.sshCommand); empty: ssh's own choice (agent, ~/.ssh/config). */
  sshKey: string;
  signing: SigningFormat;
  /** OpenPGP key id/fingerprint, or the SSH public key file for `ssh` signing. */
  signingKey: string;
}

export const MAX_PROFILES = 20;

/** An SSH key pair in ~/.ssh (or a generated one). */
export interface SshKeyInfo {
  /** Private key path. */
  path: string;
  publicPath: string;
  type: string;
  bits: number;
  fingerprint: string;
  comment: string;
  /** Loaded in the running ssh-agent. */
  inAgent: boolean;
}

export interface SshAgentInfo {
  /** SSH_AUTH_SOCK is set and the agent answers. */
  running: boolean;
  /** Fingerprints of the keys it holds. */
  fingerprints: string[];
}

export interface GpgKeyInfo {
  /** Long key id. */
  id: string;
  fingerprint: string;
  userIds: string[];
  expired: boolean;
}

export interface KeysInfo {
  sshDir: string;
  ssh: SshKeyInfo[];
  agent: SshAgentInfo;
  /** null when gpg is not installed. */
  gpg: GpgKeyInfo[] | null;
}

/** How a commit's signature checked out (git's %G?). */
export type SignatureStatus = 'good' | 'bad' | 'untrusted' | 'expired' | 'expired-key' | 'revoked' | 'unverifiable' | 'none';

export interface CommitSignature {
  status: SignatureStatus;
  format: 'openpgp' | 'ssh' | 'x509' | null;
  /** Who signed (%GS): a user id or the email of the allowed signer. */
  signer: string;
  /** Key id or fingerprint (%GK / %GF). */
  key: string;
}

export interface ProfileApplied {
  /** The profile whose identity is in effect for the repository (or globally), if any. */
  current: string | null;
  userName: string;
  email: string;
  signing: boolean;
}

const FIELD = /^[^\0\r\n]{0,300}$/;
const ID = /^[a-z0-9-]{1,40}$/;

/** Validates profiles from a window (untrusted). */
export function parseProfiles(value: unknown): Profile[] {
  if (!Array.isArray(value) || value.length > MAX_PROFILES) throw new TypeError(`Profiles must be a list of up to ${MAX_PROFILES}`);
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) throw new TypeError(`Profile ${index + 1} must be an object`);
    const { id, label, userName, email, sshKey, signing, signingKey } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !ID.test(id) || ids.has(id)) throw new TypeError(`Profile ${index + 1} needs a unique id`);
    ids.add(id);
    for (const [name, field] of Object.entries({ label, userName, email, sshKey, signingKey })) {
      if (typeof field !== 'string' || !FIELD.test(field)) throw new TypeError(`${name} of profile ${index + 1} must be text on one line`);
    }
    if (!(label as string).trim()) throw new TypeError(`Profile ${index + 1} needs a name`);
    if (signing !== 'none' && signing !== 'openpgp' && signing !== 'ssh') throw new TypeError(`Signing of profile ${index + 1} must be none, openpgp or ssh`);
    return {
      id,
      label: (label as string).trim(),
      userName: (userName as string).trim(),
      email: (email as string).trim(),
      sshKey: (sshKey as string).trim(),
      signing,
      signingKey: (signingKey as string).trim(),
    };
  });
}
