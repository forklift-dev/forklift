import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseProfiles, type Profile } from '../../shared/profiles';
import { GitCli } from '../git/cli';
import { directRunner } from '../process/testing';
import { ProfileService } from './service';

let home: string;
let repo: string;
let env: Record<string, string>;
let service: ProfileService;
let git: GitCli;
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim();
const profile = (change: Partial<Profile> = {}): Profile => ({ id: 'work', label: 'Work', userName: 'Ada Work', email: 'ada@work.example', sshKey: '', signing: 'none', signingKey: '', ...change });
const hasGpg = (() => {
  try {
    execFileSync('gpg', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-profiles-')));
  env = {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GNUPGHOME: join(home, 'gnupg'),
  };
  mkdirSync(env['GNUPGHOME']!, { mode: 0o700 });
  writeFileSync(env['GIT_CONFIG_GLOBAL']!, '');
  repo = join(home, 'repo');
  mkdirSync(repo);
  sh(repo, 'init', '-q', '--initial-branch=main');
  git = new GitCli(directRunner(env));
  service = new ProfileService({ git, runner: directRunner(env), askpass: { session: () => ({ env: {}, dispose: () => {} }) }, allowedSignersFile: join(home, 'forklift', 'allowed_signers'), home });
});
afterEach(() => {
  // The OpenPGP test starts a gpg-agent for its own GNUPGHOME.
  if (hasGpg) execFileSync('gpgconf', ['--kill', 'gpg-agent'], { env, stdio: 'ignore' });
  rmSync(home, { recursive: true, force: true });
});

describe('parseProfiles', () => {
  it('accepts valid profiles and trims them', () => {
    expect(parseProfiles([{ ...profile(), label: ' Work ' }])).toEqual([profile()]);
  });

  it.each([
    ['not a list', /list of up to 20/],
    [[{ ...profile(), id: 'Bad Id' }], /unique id/],
    [[profile(), profile()], /unique id/],
    [[{ ...profile(), label: ' ' }], /needs a name/],
    [[{ ...profile(), email: 'a\nb' }], /email of profile 1/],
    [[{ ...profile(), signing: 'x509' }], /none, openpgp or ssh/],
  ])('rejects %j', (value, message) => {
    expect(() => parseProfiles(value)).toThrow(message);
  });
});

describe('ProfileService', () => {
  it('applies a profile globally or to one repository and recognizes it', async () => {
    const work = profile();
    const home2 = profile({ id: 'home', label: 'Home', userName: 'Ada', email: 'ada@home.example' });
    await service.apply(home2, null);
    expect(sh(repo, 'config', '--global', 'user.email')).toBe('ada@home.example');
    expect(await service.current(repo, [work, home2])).toMatchObject({ current: 'home', email: 'ada@home.example', signing: false });
    await service.apply(work, repo);
    expect(sh(repo, 'config', '--local', 'user.email')).toBe('ada@work.example');
    expect(sh(repo, 'config', '--local', 'commit.gpgsign')).toBe('false');
    expect(await service.current(repo, [work, home2])).toMatchObject({ current: 'work', userName: 'Ada Work' });
    expect(await service.current(null, [work, home2])).toMatchObject({ current: 'home' });
    await expect(service.apply(profile({ email: '' }), repo)).rejects.toThrow(/needs a name and an email/);
  });

  it('points ssh at the chosen key, and removes only its own ssh command again', async () => {
    const key = await service.generateSshKey('id_work', 'ada@work', '');
    await service.apply(profile({ sshKey: key.path }), repo);
    expect(sh(repo, 'config', '--local', 'core.sshCommand')).toBe(`ssh -i '${key.path}' -o IdentitiesOnly=yes`);
    await service.apply(profile(), repo);
    expect(() => sh(repo, 'config', '--local', 'core.sshCommand')).toThrow();
    sh(repo, 'config', '--local', 'core.sshCommand', 'ssh -F /my/config');
    await service.apply(profile(), repo);
    expect(sh(repo, 'config', '--local', 'core.sshCommand')).toBe('ssh -F /my/config');
    await expect(service.apply(profile({ sshKey: join(home, 'missing') }), repo)).rejects.toThrow(/was not found/);
  });

  it('generates ed25519 keys in ~/.ssh and lists them', async () => {
    const key = await service.generateSshKey('id_test', 'ada@example', 'secret phrase');
    expect(key).toMatchObject({ path: join(home, '.ssh', 'id_test'), type: 'ED25519', bits: 256, comment: 'ada@example', inAgent: false });
    expect(key.fingerprint).toMatch(/^SHA256:/);
    const { ssh, agent, sshDir } = await service.keys();
    expect(sshDir).toBe(join(home, '.ssh'));
    expect(ssh.map((k) => k.path)).toEqual([key.path]);
    expect(agent.running).toBe(false);
    expect(await service.publicKey(key.publicPath)).toMatch(/^ssh-ed25519 \S+ ada@example$/);
    await expect(service.generateSshKey('id_test', '', '')).rejects.toThrow(/already exists/);
    await expect(service.generateSshKey('../evil', '', '')).rejects.toThrow(/file name/);
    await expect(service.generateSshKey('short', '', 'abc')).rejects.toThrow(/at least 5/);
    await expect(service.publicKey(key.path)).rejects.toThrow(/public key/);
  });

  it('signs commits with an SSH key and verifies them with the profiles as allowed signers', async () => {
    const key = await service.generateSshKey('id_sign', 'ada@work', '');
    const work = profile({ signing: 'ssh', signingKey: key.publicPath });
    await service.apply(work, repo);
    await service.writeAllowedSigners([work]);
    expect(readFileSync(join(home, 'forklift', 'allowed_signers'), 'utf8')).toMatch(/^ada@work\.example namespaces="git" ssh-ed25519 \S+\n$/);
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    sh(repo, 'add', '.');
    sh(repo, 'commit', '-qm', 'signed');
    const signed = await service.signature(repo, sh(repo, 'rev-parse', 'HEAD'));
    expect(signed).toMatchObject({ status: 'good', format: 'ssh', signer: 'ada@work.example', key: key.fingerprint });

    // Without the key among the allowed signers it can't be verified.
    await service.writeAllowedSigners([]);
    expect((await service.signature(repo, sh(repo, 'rev-parse', 'HEAD'))).status).not.toBe('good');

    sh(repo, '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'unsigned');
    expect(await service.signature(repo, sh(repo, 'rev-parse', 'HEAD'))).toMatchObject({ status: 'none', format: null });
  });

  it.runIf(hasGpg)('lists OpenPGP keys and verifies OpenPGP signatures', async () => {
    execFileSync('gpg', ['--batch', '--passphrase', '', '--quick-gen-key', 'Ada Work <ada@work.example>', 'ed25519', 'sign', 'never'], { env, stdio: 'pipe' });
    const { gpg } = await service.keys();
    expect(gpg).toHaveLength(1);
    expect(gpg![0]!.userIds).toEqual(['Ada Work <ada@work.example>']);
    expect(gpg![0]!.fingerprint).toMatch(/^[0-9A-F]{40}$/);
    await service.apply(profile({ signing: 'openpgp', signingKey: gpg![0]!.fingerprint }), repo);
    sh(repo, 'commit', '-q', '--allow-empty', '-m', 'pgp');
    const signature = await service.signature(repo, sh(repo, 'rev-parse', 'HEAD'));
    expect(signature).toMatchObject({ status: 'good', format: 'openpgp', signer: 'Ada Work <ada@work.example>', key: gpg![0]!.fingerprint });
  }, 30_000);
});
