import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { CommitSignature, GpgKeyInfo, KeysInfo, Profile, ProfileApplied, SignatureStatus, SshAgentInfo, SshKeyInfo } from '../../shared/profiles';
import type { AskpassServer } from '../askpass/server';
import type { GitCli } from '../git/cli';
import type { Runner } from '../process/types';

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

export interface ProfileServiceDeps {
  git: GitCli;
  runner: Runner;
  askpass: Pick<AskpassServer, 'session'>;
  /** Allowed signers built from the profiles' SSH signing keys (for checking SSH signatures). */
  allowedSignersFile: string;
  home?: string;
}

const STATUS: Record<string, SignatureStatus> = { G: 'good', B: 'bad', U: 'untrusted', X: 'expired', Y: 'expired-key', R: 'revoked', E: 'unverifiable', N: 'none' };
const KEY_NAME = /^[\w.-]{1,64}$/;
// core.sshCommand written by a profile; other values belong to the user and are left alone.
const OUR_SSH_COMMAND = /^ssh -i '.*' -o IdentitiesOnly=yes$/;

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** Applies profiles to git config, lists and creates SSH keys, lists GPG keys and checks commit signatures. */
export class ProfileService {
  private readonly home: string;

  constructor(private readonly deps: ProfileServiceDeps) {
    this.home = deps.home ?? homedir();
  }

  get sshDir(): string {
    return join(this.home, '.ssh');
  }

  /** Writes the profile's identity, SSH key and signing to the repository's config (`root`) or the global one. */
  async apply(profile: Profile, root: string | null): Promise<void> {
    if (!profile.userName || !profile.email) throw new ProfileError('The profile needs a name and an email');
    const set = (key: string, value: string) => this.config(root, [key, value]);
    const unset = (key: string) => this.config(root, ['--unset', key], [5]);
    await set('user.name', profile.userName);
    await set('user.email', profile.email);

    const sshCommand = (await this.get(root, 'core.sshCommand')).trim();
    if (profile.sshKey) {
      await this.assertKeyFile(profile.sshKey, 'SSH key');
      await set('core.sshCommand', `ssh -i ${shellQuote(profile.sshKey)} -o IdentitiesOnly=yes`);
    } else if (OUR_SSH_COMMAND.test(sshCommand)) await unset('core.sshCommand');

    if (profile.signing === 'none') {
      // In a repository, "no signing" must also win over a global commit.gpgsign.
      if (root) await set('commit.gpgsign', 'false');
      else await unset('commit.gpgsign');
      return;
    }
    if (!profile.signingKey) throw new ProfileError('Choose the key to sign with');
    if (profile.signing === 'ssh') await this.assertKeyFile(profile.signingKey, 'SSH signing key');
    await set('gpg.format', profile.signing);
    await set('user.signingkey', profile.signingKey);
    await set('commit.gpgsign', 'true');
    await set('tag.gpgsign', 'true');
  }

  /** The identity in effect (repository config over global) and which profile it is. */
  async current(root: string | null, profiles: readonly Profile[]): Promise<ProfileApplied> {
    const get = (key: string) => this.get(root, key, true);
    const [userName, email, sign] = await Promise.all([get('user.name'), get('user.email'), get('commit.gpgsign')]);
    const match = profiles.find((profile) => profile.userName === userName && profile.email === email);
    return { current: match?.id ?? null, userName, email, signing: sign === 'true' };
  }

  async keys(): Promise<KeysInfo> {
    const env = await this.deps.runner.environment();
    const agent = await this.agent(env);
    const ssh: SshKeyInfo[] = [];
    const names = await readdir(this.sshDir).catch(() => [] as string[]);
    for (const name of names.filter((file) => file.endsWith('.pub')).sort()) {
      const publicPath = join(this.sshDir, name);
      const path = publicPath.slice(0, -4);
      if (!(await stat(path).then((info) => info.isFile(), () => false))) continue;
      const info = await this.fingerprint(publicPath);
      if (info) ssh.push({ ...info, path, publicPath, inAgent: agent.fingerprints.includes(info.fingerprint) });
    }
    return { sshDir: this.sshDir, ssh, agent, gpg: await this.gpgKeys() };
  }

  /**
   * A new ed25519 key in ~/.ssh. The passphrase reaches ssh-keygen as an argument (it reads one only from a
   * terminal otherwise); it is not stored.
   */
  async generateSshKey(name: unknown, comment: unknown, passphrase: unknown): Promise<SshKeyInfo> {
    if (typeof name !== 'string' || !KEY_NAME.test(name) || name.endsWith('.pub')) throw new ProfileError('Use letters, digits, dots, dashes and underscores for the key file name');
    if (typeof comment !== 'string' || comment.length > 200 || /[\0\r\n]/.test(comment)) throw new ProfileError('The comment must be one line');
    if (typeof passphrase !== 'string' || passphrase.length > 1024 || passphrase.includes('\0')) throw new ProfileError('The passphrase is not valid');
    if (passphrase && passphrase.length < 5) throw new ProfileError('Use at least 5 characters for the passphrase, or none');
    const path = join(this.sshDir, name);
    if (await stat(path).then(() => true, () => false)) throw new ProfileError(`${path} already exists`);
    await mkdir(this.sshDir, { recursive: true, mode: 0o700 });
    const result = await this.deps.runner.run('ssh-keygen', ['-q', '-t', 'ed25519', '-C', comment, '-N', passphrase, '-f', path], { timeoutMs: 30_000 });
    if (result.code !== 0) throw new ProfileError(`ssh-keygen failed: ${result.stderr.trim() || `exit code ${result.code}`}`);
    const info = await this.fingerprint(`${path}.pub`);
    if (!info) throw new ProfileError('The new key could not be read');
    return { ...info, path, publicPath: `${path}.pub`, inAgent: false };
  }

  /** Loads a key into the ssh-agent; a passphrase is asked in the app. */
  async addToAgent(path: unknown): Promise<void> {
    if (typeof path !== 'string') throw new ProfileError('Choose a key');
    await this.assertKeyFile(path, 'SSH key');
    const session = this.deps.askpass.session(null);
    try {
      const result = await this.deps.runner.run('ssh-add', [path], { env: session.env, timeoutMs: 120_000 });
      if (result.code !== 0) throw new ProfileError(`ssh-add failed: ${result.stderr.trim() || `exit code ${result.code}`}`);
    } finally {
      session.dispose();
    }
  }

  /** A public key's text, for copying to a hosting service. */
  async publicKey(path: unknown): Promise<string> {
    if (typeof path !== 'string' || !isAbsolute(path) || !path.endsWith('.pub')) throw new ProfileError('Choose a public key (.pub)');
    const text = (await readFile(path, 'utf8').catch(() => '')).trim();
    if (!/^(?:ssh-|ecdsa-|sk-)\S+ \S+/.test(text) || text.length > 16_384) throw new ProfileError(`${path} is not an SSH public key`);
    return text;
  }

  /** Allowed signers for the profiles' SSH signing keys (email + public key), used when git has none of its own. */
  async writeAllowedSigners(profiles: readonly Profile[]): Promise<void> {
    const lines: string[] = [];
    for (const profile of profiles) {
      if (profile.signing !== 'ssh' || !profile.email || !profile.signingKey) continue;
      const key = await this.publicKey(profile.signingKey).catch(() => null);
      if (key) lines.push(`${profile.email} namespaces="git" ${key.split(' ').slice(0, 2).join(' ')}`);
    }
    await mkdir(dirname(this.deps.allowedSignersFile), { recursive: true });
    await writeFile(this.deps.allowedSignersFile, lines.length ? `${lines.join('\n')}\n` : '', { mode: 0o600 });
  }

  /** How a commit's signature checks out (git log %G?), with who signed it. */
  async signature(root: string, sha: string): Promise<CommitSignature> {
    const own = (await this.get(root, 'gpg.ssh.allowedSignersFile', true)).trim();
    const args = [...(own ? [] : ['-c', `gpg.ssh.allowedSignersFile=${this.deps.allowedSignersFile}`]), 'show', '-s', '--format=%G?%x00%GS%x00%GK%x00%GF%x00%GG', sha, '--'];
    const { stdout } = await this.deps.git.exec(args, { cwd: root, readOnly: true, timeoutMs: 30_000 });
    const [code = 'N', signer = '', key = '', fingerprint = '', raw = ''] = stdout.split('\0');
    const status = STATUS[code.trim()] ?? 'unverifiable';
    const format = status === 'none' ? null : /ssh/i.test(raw) || /^SHA256:/.test(fingerprint || key) ? 'ssh' : /x509|gpgsm/i.test(raw) ? 'x509' : 'openpgp';
    return { status, format, signer: signer.trim(), key: (fingerprint || key).trim() };
  }

  private async agent(env: Record<string, string>): Promise<SshAgentInfo> {
    if (!env['SSH_AUTH_SOCK']) return { running: false, fingerprints: [] };
    const result = await this.deps.runner.run('ssh-add', ['-l'], { timeoutMs: 10_000 }).catch(() => null);
    // Exit 1: the agent answers but holds no keys; 2: no agent.
    if (!result || (result.code !== 0 && result.code !== 1)) return { running: false, fingerprints: [] };
    return { running: true, fingerprints: result.stdout.split('\n').map((line) => line.split(' ')[1] ?? '').filter(Boolean) };
  }

  private async fingerprint(publicPath: string): Promise<Omit<SshKeyInfo, 'path' | 'publicPath' | 'inAgent'> | null> {
    const result = await this.deps.runner.run('ssh-keygen', ['-l', '-f', publicPath], { timeoutMs: 10_000 }).catch(() => null);
    // "256 SHA256:abc… comment words (ED25519)"
    const match = result?.code === 0 ? /^(\d+) (\S+) (.*) \(([^)]+)\)\s*$/.exec(result.stdout.trim()) : null;
    if (!match) return null;
    const comment = match[3]!;
    return { bits: Number(match[1]), fingerprint: match[2]!, comment: comment === 'no comment' ? '' : comment, type: match[4]! };
  }

  private async gpgKeys(): Promise<GpgKeyInfo[] | null> {
    const result = await this.deps.runner.run('gpg', ['--batch', '--list-secret-keys', '--with-colons', '--fixed-list-mode'], { timeoutMs: 15_000 }).catch(() => null);
    if (!result) return null;
    if (result.code !== 0 && !result.stdout) return [];
    const keys: GpgKeyInfo[] = [];
    for (const line of result.stdout.split('\n')) {
      const fields = line.split(':');
      if (fields[0] === 'sec') keys.push({ id: fields[4] ?? '', fingerprint: '', userIds: [], expired: fields[1] === 'e' || fields[1] === 'r' });
      else if (fields[0] === 'fpr' && keys.length && !keys.at(-1)!.fingerprint) keys.at(-1)!.fingerprint = fields[9] ?? '';
      else if (fields[0] === 'uid' && keys.length) keys.at(-1)!.userIds.push((fields[9] ?? '').replace(/\\x3a/g, ':'));
    }
    return keys;
  }

  private async assertKeyFile(path: string, what: string): Promise<void> {
    if (!isAbsolute(path) || /[\0\r\n]/.test(path)) throw new ProfileError(`${what}: use the full path of the key file`);
    if (!(await stat(path).then((info) => info.isFile(), () => false))) throw new ProfileError(`${what}: ${basename(path)} was not found`);
  }

  private async get(root: string | null, key: string, effective = false): Promise<string> {
    const scope = effective ? [] : [root ? '--local' : '--global'];
    const { stdout } = await this.deps.git.exec(['config', ...scope, '--get', key], { cwd: root ?? this.home, readOnly: true, allowedExitCodes: [1] });
    return stdout.trim();
  }

  private async config(root: string | null, args: string[], allowedExitCodes: number[] = []): Promise<void> {
    await this.deps.git.exec(['config', root ? '--local' : '--global', ...args], { cwd: root ?? this.home, allowedExitCodes });
  }
}
