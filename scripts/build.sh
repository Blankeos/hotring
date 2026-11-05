#!/bin/sh
# Bundle the client into dist/ (served as Workers static assets) and copy the sounds.
set -e
cd "$(dirname "$0")/.."
rm -rf dist
bun build client/index.html --outdir dist --minify
cp -R public/sfx dist/sfx
