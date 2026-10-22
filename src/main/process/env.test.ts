import { describe, expect, it } from 'vitest';
import { sanitizeEnv } from './env';

describe('sanitizeEnv', () => {
  it('drops Electron and Node runtime variables', () => {
    expect(
      sanitizeEnv({
        HOME: '/home/u',
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_NO_ATTACH_CONSOLE: '1',
        CHROME_DESKTOP: 'forklift.desktop',
        NODE_OPTIONS: '--inspect',
        VSCODE_PID: '1',
        UNDEFINED_VALUE: undefined,
      }),
    ).toEqual({ HOME: '/home/u' });
  });

  it('restores the desktop name Electron overrode', () => {
    expect(sanitizeEnv({ XDG_CURRENT_DESKTOP: 'Unity', ORIGINAL_XDG_CURRENT_DESKTOP: 'GNOME' })).toEqual({
      XDG_CURRENT_DESKTOP: 'GNOME',
    });
  });

  it.skipIf(process.platform === 'win32')('removes AppImage mount entries from path lists', () => {
    expect(
      sanitizeEnv({
        APPIMAGE: '/home/u/Forklift.AppImage',
        APPDIR: '/tmp/.mount_ForkliAbc',
        ARGV0: 'Forklift',
        OWD: '/home/u',
        PATH: '/tmp/.mount_ForkliAbc/usr/bin:/usr/local/bin:/usr/bin',
        LD_LIBRARY_PATH: '/tmp/.mount_ForkliAbc/usr/lib',
        XDG_DATA_DIRS: '/tmp/.mount_ForkliAbc/usr/share:/usr/share',
      }),
    ).toEqual({ PATH: '/usr/local/bin:/usr/bin', XDG_DATA_DIRS: '/usr/share' });
  });

  it('keeps path lists untouched outside an AppImage', () => {
    const env = { APPDIR: '/opt/thing', PATH: '/opt/thing/bin:/usr/bin' };
    expect(sanitizeEnv(env)).toEqual(env);
  });
});
