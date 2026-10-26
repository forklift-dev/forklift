#!/usr/bin/env python3
"""Launch a Git GUI on a repository under the current X display (xvfb) and measure, per run:
- window: seconds until a visible top-level window of the app exists;
- settle: seconds until the app's process tree stays below 3% of one CPU for 2 s (proxy for "loaded");
- cpu: CPU seconds the tree used until then; pss: proportional memory of the tree (MiB) at settle;
and a screenshot to check that the repository really opened.
Usage: launch_bench.py NAME OUT_DIR -- COMMAND... (the repository path is part of COMMAND)."""
import json, os, shutil, signal, subprocess, sys, tempfile, time

HZ = os.sysconf('SC_CLK_TCK')


def tree(sid):
    pids = []
    for entry in os.listdir('/proc'):
        if not entry.isdigit():
            continue
        try:
            with open(f'/proc/{entry}/stat') as f:
                fields = f.read().rsplit(')', 1)[1].split()
            if int(fields[3]) == sid:  # session id
                pids.append(int(entry))
        except (OSError, IndexError, ValueError):
            pass
    return pids


def cpu_seconds(pids):
    total = 0
    for pid in pids:
        try:
            with open(f'/proc/{pid}/stat') as f:
                fields = f.read().rsplit(')', 1)[1].split()
            total += int(fields[11]) + int(fields[12])
        except (OSError, IndexError, ValueError):
            pass
    return total / HZ


def pss_mib(pids):
    total = 0
    for pid in pids:
        try:
            with open(f'/proc/{pid}/smaps_rollup') as f:
                for line in f:
                    if line.startswith('Pss:'):
                        total += int(line.split()[1])
        except OSError:
            pass
    return total / 1024


def visible_window(pids):
    for pid in pids:
        out = subprocess.run(['xdotool', 'search', '--onlyvisible', '--pid', str(pid)], capture_output=True, text=True).stdout.split()
        for wid in out:
            geo = subprocess.run(['xdotool', 'getwindowgeometry', wid], capture_output=True, text=True).stdout
            if 'Geometry:' in geo:
                w, h = geo.split('Geometry:')[1].split()[0].split('x')
                if int(w) > 300 and int(h) > 200:
                    return wid
    return None


def main():
    name, out_dir = sys.argv[1], sys.argv[2]
    command = sys.argv[sys.argv.index('--') + 1:]
    home = tempfile.mkdtemp(prefix=f'bench-home-{name}-')
    env = {**os.environ, 'HOME': home, 'XDG_CONFIG_HOME': f'{home}/.config', 'XDG_DATA_HOME': f'{home}/.local/share',
           'XDG_STATE_HOME': f'{home}/.local/state', 'XDG_CACHE_HOME': f'{home}/.cache', 'APPIMAGE_EXTRACT_AND_RUN': '1',
           'GIT_CONFIG_GLOBAL': '/dev/null',
           # Software rendering under xvfb (WebKitGTK cannot get an EGL display otherwise).
           'LIBGL_ALWAYS_SOFTWARE': '1', 'WEBKIT_DISABLE_DMABUF_RENDERER': '1', 'WEBKIT_DISABLE_COMPOSITING_MODE': '1'}
    env.pop('WAYLAND_DISPLAY', None)
    start = time.monotonic()
    proc = subprocess.Popen(command, env=env, stdout=subprocess.DEVNULL, stderr=open(f'{out_dir}/{name}.stderr', 'w'), start_new_session=True)
    sid = proc.pid
    window = settle = None
    quiet_since = None
    last_cpu, last_t = 0.0, start
    result = {}
    while time.monotonic() - start < 180:
        time.sleep(0.25)
        now = time.monotonic()
        pids = tree(sid)
        if not pids:
            result['error'] = 'exited'
            break
        if window is None and visible_window(pids):
            window = now - start
        cpu = cpu_seconds(pids)
        load = (cpu - last_cpu) / (now - last_t)
        last_cpu, last_t = cpu, now
        if window is not None and load < 0.03:
            quiet_since = quiet_since or now
            if now - quiet_since >= 2:
                settle = quiet_since - start
                break
        else:
            quiet_since = None
    pids = tree(sid)
    result.update({'name': name, 'window_s': round(window, 2) if window else None, 'settle_s': round(settle, 2) if settle else None,
                   'cpu_s': round(cpu_seconds(pids), 2), 'pss_mib': round(pss_mib(pids)), 'processes': len(pids)})
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'x11grab', '-video_size', '1600x1000', '-i', os.environ['DISPLAY'], '-frames:v', '1', f'{out_dir}/{name}.png'], capture_output=True)
    os.killpg(sid, signal.SIGTERM)
    time.sleep(2)
    try:
        os.killpg(sid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    shutil.rmtree(home, ignore_errors=True)
    print(json.dumps(result))


main()
