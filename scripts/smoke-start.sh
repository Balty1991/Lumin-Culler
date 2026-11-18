#!/usr/bin/env bash
# Testul de pornire: instalează APK-ul pe emulator, deschide aplicația și verifică
# că ajunge la „Azi” (cel mult 120 s), că procesul trăiește și că nu a căzut nimic.
# Versiunea 46 a ajuns în magazin căzând la pornire; testul ăsta ar fi oprit-o.
set -uo pipefail
APK="$1"; PKG=com.luminculler.app; OUT="${2:-smoke-out}"
mkdir -p "$OUT"
adb logcat -c
adb install -r -g "$APK" || { echo "::error::APK-ul nu s-a instalat pe emulator"; exit 1; }
adb shell am start -W -n "$PKG/.MainActivity"
# Așteaptă semnalul „Azi e desenat” cel mult 120 s (emulatorul din CI e uneori lent),
# și se oprește imediat la o cădere. Apoi încă 10 s, ca o cădere târzie să se vadă.
for i in $(seq 1 24); do
  sleep 5
  adb logcat -d > "$OUT/logcat.txt"
  grep -q "Cherrypic: appReady" "$OUT/logcat.txt" && break
  grep -A30 "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -q "$PKG" && break
done
sleep 10
adb exec-out screencap -p > "$OUT/pornire.png" || true
adb logcat -d > "$OUT/logcat.txt"
fail=0
if ! adb shell pidof "$PKG" > /dev/null; then echo "::error::Aplicația nu mai rulează după pornire"; fail=1; fi
if grep -A30 "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -q "$PKG"; then
  echo "::error::Aplicația a căzut la pornire:"; grep -A30 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -40; fail=1
fi
if grep -q "ANR in $PKG" "$OUT/logcat.txt"; then echo "::error::Aplicația nu răspunde (ANR) la pornire"; fail=1; fi
# Pagina a ajuns să deseneze „Azi” (DevicePlugin.appReady): altfel rămânea ecranul cu cireașa.
if grep -q "Cherrypic: appReady" "$OUT/logcat.txt"; then echo "Pagina a semnalat că „Azi” e desenat."; else echo "::error::Pagina nu a ajuns să deseneze „Azi” în 120 s (lipsește appReady)."; fail=1; fi
if [ "$fail" != 0 ]; then
  echo "── Ce a scris aplicația (consola paginii, Capacitor, căderi) ──"
  grep -E "Capacitor|chromium|Console|Cherrypic|AndroidRuntime|WebView" "$OUT/logcat.txt" | grep -v "^-" | tail -120
fi
[ "$fail" = 0 ] && echo "Pornirea pe emulator: în regulă."
exit $fail
