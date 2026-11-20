#!/usr/bin/env bash
# Cât din cod a redenumit R8 (obscurizare), din mapping.txt. Play cere minimum 25%
# (pragul de optimizare DEX din februarie 2027). Scrie procentul și în rezumatul rulării.
set -euo pipefail
map="${1:?mapping.txt}"
total=$(grep -cE '^[^ #].* -> .*:$' "$map" || true)
renamed=$(grep -E '^[^ #].* -> .*:$' "$map" | awk '{orig=$1; sub(/:$/,"",$3); if (orig != $3) n++} END {print n+0}')
app_total=$(grep -E '^com\.luminculler\.' "$map" | grep -cE ' -> .*:$' || true)
app_renamed=$(grep -E '^com\.luminculler\.[^ ]* -> .*:$' "$map" | awk '{orig=$1; sub(/:$/,"",$3); if (orig != $3) n++} END {print n+0}')
pct=$(( total > 0 ? renamed * 100 / total : 0 ))
line="R8: $renamed din $total clase redenumite (${pct}%); din codul Cherrypic: $app_renamed din $app_total."
echo "$line"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "### $line" >> "$GITHUB_STEP_SUMMARY"
if [ "$pct" -lt 25 ]; then echo "::warning::Obscurizarea R8 e ${pct}%, sub pragul Play de 25%."; fi

# De ce e mic procentul: cine oprește obscurizarea (-dontobfuscate) și ce reguli păstrează tot.
conf="$(dirname "$map")/configuration.txt"
if [ -f "$conf" ]; then
  echo "── -dontobfuscate în configurație (cu fișierul de unde vine) ──"
  awk '/^# The proguard configuration file for the following section is /{src=$0} /^-dontobfuscate/{print src; print "   " $0}' "$conf" | head -20
  echo "── Regulile -keep cele mai largi ──"
  grep -nE '^-keep[a-z]* (public )?class [a-zA-Z0-9_.]+\.\*\* *\{ *\*; *\}' "$conf" | head -30
fi
