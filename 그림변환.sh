#!/bin/bash
# 엔딩 그림 변환 — 여백 자르고 정사각 규격으로 맞춘다
#
#   ./그림변환.sh <원본파일> <번호>
#   예:  ./그림변환.sh ~/Desktop/스크린샷*.png 18     → img/end/end18.png
#
# 하는 일: 검은 배경이면 자동 반전 → 여백 잘라내기 → 가운데 정렬 → 1000x1000 흰 바탕
set -e
eval "$(/opt/homebrew/bin/brew shellenv zsh)" 2>/dev/null || true

SRC="$1"; NUM="$2"
SIZE=1000            # 최종 한 변 (정사각)
PAD=60               # 그림 둘레 여백

[ -z "$SRC" ] || [ -z "$NUM" ] && { echo "사용법: ./그림변환.sh <파일> <번호>"; exit 1; }
[ -f "$SRC" ] || { echo "파일 없음: $SRC"; exit 1; }

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/img/end/end$(printf '%02d' "$NUM").png"
mkdir -p "$DIR/img/end"

# 평균 밝기로 배경이 어두운지 판단 → 어두우면 반전
MEAN=$(magick "$SRC" -colorspace Gray -format "%[fx:mean]" info:)
NEG=""
if (( $(echo "$MEAN < 0.5" | bc -l) )); then NEG="-negate"; echo "  어두운 배경 감지 → 색 반전"; fi

INNER=$((SIZE - PAD * 2))
magick "$SRC" \
  $NEG \
  -colorspace Gray \
  -background white -alpha remove -alpha off \
  -fuzz 22% -trim +repage \
  -resize ${INNER}x${INNER}\> \
  -gravity center -background white -extent ${SIZE}x${SIZE} \
  -strip \
  "$OUT"

echo "  → $(basename "$OUT")  $(magick identify -format '%wx%h  %B bytes' "$OUT")"
