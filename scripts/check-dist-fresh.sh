#!/usr/bin/env bash
# Vercel serves the committed dist/, not a fresh build of src/ (vercel.json).
# A commit that changes src/ without rebuilding dist/ deploys nothing: that is
# how the 17 Oct fix sat on main while production kept wiping learner records.
#
# Rebuilds dist/ from the committed src/ and fails if that changes any
# compiled .js, i.e. if what you are about to push is not what you wrote.
# Run before every push, from a tree with src/ committed:
#   yarn check:dist
set -euo pipefail

cd "$(dirname "$0")/.."

# Everything the build reads: tsconfig has no "include", so every .ts in the
# repo (src/, scripts/, backup.ts) compiles into dist/, and nest-cli copies
# assets from src/ (certificate templates).
dirty="$(git status --porcelain -- src '*.ts' 'tsconfig*.json' nest-cli.json \
  package.json yarn.lock prisma ':!dist' ':!node_modules')"
if [ -n "$dirty" ]; then
  echo "Commit your source first: dist/ is checked against committed source." >&2
  echo "$dirty" >&2
  exit 1
fi

npx nest build >/dev/null

# What runs: compiled JavaScript and copied assets (.d.ts/.map and the build
# cache are ignored).
changed="$(git status --porcelain -- dist ':!dist/**/*.d.ts' ':!dist/*.d.ts' \
  ':!dist/**/*.map' ':!dist/*.map' ':!dist/*.tsbuildinfo')"
if [ -n "$changed" ]; then
  echo "dist/ was out of date with src/ and has now been rebuilt." >&2
  echo "Commit dist/ before pushing, or production will not get your change:" >&2
  echo "$changed" >&2
  exit 1
fi

echo "dist/ matches src/."
