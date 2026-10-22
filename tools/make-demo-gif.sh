#!/usr/bin/env bash
#
# Build the README demo GIF from a screen recording.
#
#   tools/make-demo-gif.sh <recording> [start] [duration] [width]
#
# Defaults: start 00:00:03, duration 10s, width 800px. The result goes to
# docs/media/demo.gif, which is git-ignored on purpose: the demo is hosted as a
# GitHub attachment and README points at that URL (see docs/demo-storyboard.md).
# The repo keeps the recipe, not the binary.
#
# Budget: 4.5 MB, measured, not aspirational. A 10s / 800px clip of this UI
# lands at 4.75 MB at 12 fps and 4.07 MB at 10 fps; gifsicle -O3 --lossy only
# buys another 6%, because ffmpeg already emits transparency-diffed frames.
# Below ~4 MB you are not compressing better, you are showing less: either a
# narrower frame (text stops being crisp when the README scales it back up) or
# a shorter clip. A budget the encoder cannot reach is a bug in the budget.
#
# When a pass is too big the script spends pixels in this order: first fewer
# frames at full width, then a narrower frame. The bubble animation is the
# point of the clip, so dropping 24 -> 10 fps survives better than dropping
# 800 -> 640 px.
set -euo pipefail

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "error: ffmpeg is not installed (brew install ffmpeg)" >&2
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "usage: $0 <recording> [start=00:00:03] [duration=10] [width=800]" >&2
  exit 1
fi

input=$1
start=${2:-00:00:03}
duration=${3:-10}
width=${4:-800}

root=$(cd "$(dirname "$0")/.." && pwd)
out=${OUT:-"$root/docs/media/demo.gif"}
mkdir -p "$(dirname "$out")"

budget=4500000
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

ladder=(
  "$width:24"
  "$width:18"
  "$width:15"
  "$width:12"
  "$width:10"
  "$width:8"
  "$((width * 4 / 5)):12"
  "$((width * 7 / 10)):12"
  "$((width * 7 / 10)):8"
)

for spec in "${ladder[@]}"; do
  w=${spec%%:*}
  fps=${spec##*:}

  ffmpeg -nostdin -v error -ss "$start" -t "$duration" -i "$input" \
    -vf "fps=$fps,scale=$w:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" \
    -y "$tmp/palette.png"

  ffmpeg -nostdin -v error -ss "$start" -t "$duration" -i "$input" -i "$tmp/palette.png" \
    -lavfi "fps=$fps,scale=$w:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4" \
    -loop 0 -y "$tmp/out.gif"

  size=$(wc -c <"$tmp/out.gif")
  if [ "$size" -le "$budget" ]; then
    cp "$tmp/out.gif" "$out"
    echo "wrote $out (${w}px, ${fps}fps, $((size / 1000)) KB)"
    echo
    echo "next: upload it as a GitHub attachment (drag it into an issue body or the"
    echo "README editor), then put the resulting user-attachments URL in README."
    echo "this file is git-ignored and must not be committed."
    exit 0
  fi
  echo "too big at ${w}px/${fps}fps ($((size / 1000)) KB), trying a smaller pass" >&2
done

echo "error: still over 4.5 MB; shorten the clip (-t 8) or pass a smaller width" >&2
exit 1
