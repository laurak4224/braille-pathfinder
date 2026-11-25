#!/bin/sh
# Wraps src/index.html (the Claude artifact source, which has no <html> skeleton)
# into a standalone index.html for GitHub Pages and local use.
set -e
cd "$(dirname "$0")"
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  sed -n '1,/<\/style>/p' src/index.html
  printf '</head>\n<body>\n'
  sed '1,/<\/style>/d' src/index.html
  printf '</body>\n</html>\n'
} > index.html
echo "built index.html"
