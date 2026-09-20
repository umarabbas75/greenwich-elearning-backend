#!/usr/bin/env bash
#
# Rebuilds the vendored certificate fonts.
#
# Google ships these families as variable fonts, which pdf-lib embeds at their
# default weight — so each face is first instanced to the weight the design
# uses, then subset to Latin coverage.
#
# Layout features are stripped deliberately (--layout-features=''): fontkit
# applies GSUB when laying out text, and the ligature/kern tables in these
# instanced faces produce visible defects ("Certifi cate", "TOMOR ROW").
#
# Requires fonttools:  pip install fonttools brotli
# Run:                 bash scripts/certificate-art/build-fonts.sh
set -euo pipefail

DEST="$(cd "$(dirname "$0")/../.." && pwd)/src/certificate/assets/fonts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PYFTSUBSET="${PYFTSUBSET:-pyftsubset}"
PYTHON="${PYTHON:-python3}"

UNICODES="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2013-2014,U+2018-201D,U+2022,U+2026"
RAW="https://raw.githubusercontent.com/google/fonts/main/ofl"

mkdir -p "$DEST"

fetch() { curl -sSL --fail -o "$WORK/$2" "$RAW/$1"; }

instance() { # <src vf> <weight> <out>
  "$PYTHON" - "$WORK/$1" "$2" "$WORK/$3" <<'PY'
import sys
from fontTools import ttLib
from fontTools.varLib import instancer
src, weight, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
font = ttLib.TTFont(src)
instancer.instantiateVariableFont(font, {'wght': weight}, inplace=True, updateFontNames=True)
font.save(out)
PY
}

subset() { # <src> <out name>
  "$PYFTSUBSET" "$WORK/$1" --output-file="$DEST/$2" \
    --unicodes="$UNICODES" --layout-features='' --no-hinting --desubroutinize
  echo "  $2 $(( $(wc -c < "$DEST/$2") / 1024 ))KB"
}

echo "Fetching variable sources..."
fetch "playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf"     PlayfairDisplay-VF.ttf
fetch "cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf" CormorantGaramond-VF.ttf
fetch "montserrat/Montserrat%5Bwght%5D.ttf"               Montserrat-VF.ttf
fetch "pinyonscript/PinyonScript-Regular.ttf"             PinyonScript-Regular.ttf

echo "Instancing weights..."
instance PlayfairDisplay-VF.ttf     700 PlayfairDisplay-Bold.raw.ttf
instance CormorantGaramond-VF.ttf   500 CormorantGaramond-Medium.raw.ttf
instance Montserrat-VF.ttf          500 Montserrat-Medium.raw.ttf
instance Montserrat-VF.ttf          600 Montserrat-SemiBold.raw.ttf
instance Montserrat-VF.ttf          700 Montserrat-Bold.raw.ttf

echo "Subsetting to Latin..."
subset PlayfairDisplay-Bold.raw.ttf     PlayfairDisplay-Bold.ttf
subset CormorantGaramond-Medium.raw.ttf CormorantGaramond-Medium.ttf
subset Montserrat-Medium.raw.ttf        Montserrat-Medium.ttf
subset Montserrat-SemiBold.raw.ttf      Montserrat-SemiBold.ttf
subset Montserrat-Bold.raw.ttf          Montserrat-Bold.ttf
subset PinyonScript-Regular.ttf         PinyonScript-Regular.ttf

echo "Done. Fonts are OFL licensed — see https://fonts.google.com"
