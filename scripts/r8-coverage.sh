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

# Unde stau clasele neredenumite, pe pachete (primele 3 niveluri): aici se strâng regulile.
echo "── Clase neredenumite, pe pachete ──"
grep -E '^[^ #].* -> .*:$' "$map" | awk '{orig=$1; sub(/:$/,"",$3); if (orig == $3) { n=split(orig,a,"."); k=a[1]; for(i=2;i<=3 && i<n;i++) k=k"."a[i]; c[k]++ } } END {for (k in c) print c[k], k}' | sort -rn | head -20 | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"

# De ce e mic procentul: cine oprește obscurizarea (-dontobfuscate) și ce reguli păstrează tot.
conf="$(dirname "$map")/configuration.txt"
if [ -f "$conf" ]; then
  echo "── -dontobfuscate în configurație (cu fișierul de unde vine) ──"
  awk '/^# The proguard configuration file for the following section is /{src=$0} /^-dontobfuscate/{print src; print "   " $0}' "$conf" | head -20
  echo "── Reguli care pot păstra tot (class * / class ** / -keepnames / -keeppackagenames) ──"
  awk '/^# The proguard configuration file for the following section is /{src=$0} /^-(keep[a-z,]*|keepnames|keeppackagenames|keepclassmembernames)/ && /(class|interface|enum) +(\*\*?|\*\*\.\*)( |$|\{)|^-keeppackagenames|^-keepnames|^-dontoptimize|^-dontshrink/ {print src; print "   " $0}' "$conf" | head -40
  echo "── Exemple de clase nepăstrate de reguli dar neredenumite ──"
  grep -E '^(androidx|kotlin)\.[^ ]* -> (androidx|kotlin)\.' "$map" | head -5
  echo "── Regulile -keep cele mai largi ──"
  grep -nE '^-keep[a-z]* (public )?class [a-zA-Z0-9_.]+\.\*\* *\{ *\*; *\}' "$conf" | head -30
fi
