#!/bin/sh
# AngKorGit (LD_PRELOAD of the system libwayland-client), GitComet and Forklift (fixed build) on git/git, linux
# and wide, twice each, with 300 wheel notches after loading; first without commit-graph files (as cloned),
# then with them (as after git gc / git maintenance).
S=/tmp/claude-1000/-home-akryll-forklift/7e493405-7f8a-4610-9bc7-63c384579a48/scratchpad
B=$S/bench
C=$S/competitors
OUT=$B/results-final
mkdir -p "$OUT"
export BENCH_SCROLL=300
run() {
  name=$1; shift
  xvfb-run -a -s '-screen 0 1600x1000x24' python3 "$B/launch_bench.py" "$name" "$OUT" -- "$@" | tee -a "$OUT/all.jsonl"
}
for cond in nograph graph; do
  for repo in git linux; do
    if [ $cond = nograph ]; then
      rm -f "$B/$repo/.git/objects/info/commit-graph"; rm -rf "$B/$repo/.git/objects/info/commit-graphs"
    else
      git -C "$B/$repo" commit-graph write --reachable --no-progress
    fi
  done
  for repo in git linux wide; do
    for i in 1 2; do
      LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libwayland-client.so.0 run "angkorgit-$cond-$repo-$i" "$C/angkorgit-bin/AngKorGit.AppImage" "$B/$repo"
      run "gitcomet-$cond-$repo-$i" /usr/bin/gitcomet "$B/$repo"
      run "forklift-$cond-$repo-$i" /home/akryll/forklift/dist/linux-unpacked/forklift --ozone-platform=x11 --password-store=basic "$B/$repo"
    done
  done
done
echo done
