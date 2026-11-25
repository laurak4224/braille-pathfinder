#!/bin/sh
# Build standalone entry point and the static Netlify publish directory.
set -eu
cd "$(dirname "$0")"
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  printf '<meta name="description" content="Find braille display funding, accessible checklists, agency contacts and application workflows in every US state.">\n<meta name="theme-color" content="#5426a0">\n<link rel="manifest" href="/manifest.webmanifest">\n<link rel="icon" href="/icons/icon-192.png">\n<link rel="apple-touch-icon" href="/icons/icon-192.png">\n<link rel="stylesheet" href="/app-enhancements.css">\n'
  sed -n '1,/<\/style>/p' src/index.html
  printf '</head>\n<body>\n'
  sed '1,/<\/style>/d' src/index.html
  printf '<script src="/app-enhancements.js" defer></script>\n</body>\n</html>\n'
} > index.html
mkdir -p dist
cp index.html app-enhancements.js app-enhancements.css dist/
if [ -d public ]; then cp -R public/. dist/; fi
printf 'built index.html and dist/\n'
