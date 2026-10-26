#!/bin/sh
# AngKorGit, GitComet and Forklift on the same repositories in a private xvfb, one after another, each with a
# throwaway HOME; results in results/all.jsonl and a screenshot per run.
S=/tmp/claude-1000/-home-akryll-forklift/7e493405-7f8a-4610-9bc7-63c384579a48/scratchpad
B=$S/bench
C=$S/competitors
OUT=$B/results
mkdir -p "$OUT"
run() {
  name=$1; shift
  xvfb-run -a -s '-screen 0 1600x1000x24' python3 "$B/launch_bench.py" "$name" "$OUT" -- "$@" | tee -a "$OUT/all.jsonl"
}
for repo in git linux wide; do
  for i in 1 2; do
    run "angkorgit-$repo-$i" "$C/angkorgit-bin/AngKorGit.AppImage" "$B/$repo"
    run "gitcomet-$repo-$i" /usr/bin/gitcomet "$B/$repo"
    run "forklift-$repo-$i" /home/akryll/forklift/dist/linux-unpacked/forklift --ozone-platform=x11 --password-store=basic "$B/$repo"
  done
done
echo "done: $OUT/all.jsonl"
