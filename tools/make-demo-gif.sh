#!/usr/bin/env bash
#
# Build the README demo GIF from a screen recording.
#
#   tools/make-demo-gif.sh <recording> [start] [duration] [width]
#
# Defaults: start 00:00:03, duration 10s, width 800px. The result goes to
# docs/media/demo.gif and must stay under 8 MB, which is the budget the
# storyboard in docs/demo-storyboard.md works to. When a pass is too big the
# script steps the frame rate down and tries again: 24 -> 18 -> 15 -> 12 fps.
#
# Accepted inputs are anything ffmpeg can read: the original .mov/.mp4 screen
# capture is best, because a GIF that has already been through one palette
# conversion loses colour before this script ever sees it.
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

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for fps in 24 18 15 12; do
  ffmpeg -v error -ss "$start" -t "$duration" -i "$input" \
    -vf "fps=$fps,scale=$width:-1:flags=lanczos,palettegen=max_colors=192:stats_mode=diff" \
    -y "$tmp/palette.png"

  ffmpeg -v error -ss "$start" -t "$duration" -i "$input" -i "$tmp/palette.png" \
    -lavfi "fps=$fps,scale=$width:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4" \
    -loop 0 -y "$tmp/out.gif"

  size=$(wc -c <"$tmp/out.gif")
  if [ "$size" -le 8000000 ]; then
    mv "$tmp/out.gif" "$out"
    echo "wrote $out (${fps}fps, $((size / 1000)) KB)"
    exit 0
  fi
  echo "too big at ${fps}fps ($((size / 1000)) KB), trying fewer frames" >&2
done

echo "error: still over 8 MB at 12fps; shorten the clip or pass a smaller width" >&2
exit 1
