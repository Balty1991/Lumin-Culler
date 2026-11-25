#!/usr/bin/env bash
# Turul ecranelor, după testul de pornire: aplicația pe un ecran de telefon obișnuit
# (1080×2400), câte o captură din fiecare tab și din câteva foi, plus verificarea că nu
# cade și nu îngheață pe drum. Capturile ajung în ramura ci-ecrane (vezi workflow-ul),
# ca interfața să poată fi verificată fără telefon.
set -uo pipefail
PKG=com.luminculler.app; OUT="${1:-smoke-out}/tur"
mkdir -p "$OUT"
adb shell wm size 1080x2400
adb shell wm density 440
adb shell am force-stop "$PKG"
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity" > /dev/null
for i in $(seq 1 24); do sleep 5; adb logcat -d | grep -q "Cherrypic: appReady" && break; done
sleep 8
W=1080; H=2400
tap() { adb shell input tap $(( W * $1 / 100 )) $(( H * $2 / 1000 ))
  sleep "${3:-4}"; }
shot() { adb exec-out screencap -p > "$OUT/$1.png" || true; }
swipe_up() { adb shell input swipe $(( W / 2 )) $(( H * 75 / 100 )) $(( W / 2 )) $(( H * 25 / 100 )) 400; sleep 2; }
back() { adb shell input keyevent 4; sleep 3; }

shot 01-azi
swipe_up; shot 02-azi-jos; swipe_up; shot 03-azi-jos2
# Bara de jos (ca pe telefonul raportat): Azi 12%, Galerie 31%, Întreabă 50%, Curățenie 69%, Studio 88%; y ≈ 92,5%.
tap 31 925; shot 04-galerie
swipe_up; shot 05-galerie-jos
tap 69 925; shot 06-curatenie
swipe_up; shot 07-curatenie-jos
tap 88 925; shot 08-studio
swipe_up; shot 09-studio-jos
tap 50 920; shot 10-intreaba
back
tap 12 925 3
# Prima poză din galerie, deschisă (vizualizarea unei poze și foaia de jos).
tap 31 925; tap 17 330 4; shot 11-poza
back
adb logcat -d > "$OUT/logcat.txt"
fail=0
if ! adb shell pidof "$PKG" > /dev/null; then echo "::error::Aplicația s-a închis în turul ecranelor"; fail=1; fi
if grep -A30 "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -q "$PKG"; then
  echo "::error::Aplicația a căzut în turul ecranelor:"; grep -A40 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -50; fail=1
fi
if grep -q "ANR in $PKG" "$OUT/logcat.txt"; then echo "::error::Aplicația a înghețat (ANR) în turul ecranelor"; fail=1; fi
grep -E "Capacitor/Console.*(Error|error)|chromium.*Uncaught" "$OUT/logcat.txt" | tail -20 || true
ls "$OUT"
[ "$fail" = 0 ] && echo "Turul ecranelor: în regulă."
exit $fail
