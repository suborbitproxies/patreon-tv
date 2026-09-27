#!/bin/sh
# Packages app/ into dist/PatreonTV.wgt. The package is unsigned: Apps2Samsung (or Tizen Studio)
# signs it with your Samsung certificate when installing.
set -e
cd "$(dirname "$0")/.."
node tools/build-site.js
mkdir -p dist
rm -f dist/PatreonTV.wgt
(cd app && zip -qr -X ../dist/PatreonTV.wgt . -x '*.DS_Store' -x 'author-signature.xml' -x 'signature*.xml')
echo "Built dist/PatreonTV.wgt ($(wc -c < dist/PatreonTV.wgt) bytes)"
