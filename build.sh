#!/bin/sh
# Assembles src/ into two single-file builds:
#   dist/artifact.html - page body only (for hosts that add their own <html>/<head>)
#   index.html         - full standalone document; open it directly in a browser
set -e
cd "$(dirname "$0")"
mkdir -p dist
{
  cat src/page.html
  printf '<script type="module">\n'
  cat src/10-core.js src/12-mlb.js src/14-teams.js src/20-world.js src/30-players.js src/40-physics.js src/50-play.js src/60-game.js src/65-net.js src/66-roster.js src/67-cloud.js src/68-tutorial.js src/70-ui.js
  printf '</script>\n'
} > dist/artifact.html
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n'
  cat dist/artifact.html
  printf '</body>\n</html>\n'
} > index.html
echo "built index.html ($(wc -c < index.html | tr -d ' ') bytes)"
