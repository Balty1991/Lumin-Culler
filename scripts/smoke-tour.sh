#!/usr/bin/env bash
# Turul ecranelor, după testul de pornire: aplicația pe un ecran de telefon obișnuit
# (1080×2400), câte o captură din fiecare tab și din câteva foi, plus verificarea că nu
# cade și nu îngheață pe drum. Capturile ajung în ramura ci-ecrane (vezi workflow-ul),
# ca interfața să poată fi verificată fără telefon.
# Butoanele se apasă după text (arborele de accesibilitate, uiautomator), nu după
# coordonate: emulatorul e în engleză, deci textele sunt cele din en.ts.
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
shot() { adb exec-out screencap -p > "$OUT/$1.png" || true; }
swipe_up() { adb shell input swipe $(( W / 2 )) $(( H * 70 / 100 )) $(( W / 2 )) $(( H * 30 / 100 )) 400; sleep 2; }
back() { adb shell input keyevent 4; sleep 3; }
# Apasă primul element al cărui text sau descriere e exact „$1” (altfel scrie ce a găsit).
tap_text() {
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
  adb shell cat /sdcard/ui.xml > "$OUT/ui.xml" 2>/dev/null
  local xy
  xy=$(python3 - "$1" "$OUT/ui.xml" <<'PY'
import re, sys
want, path = sys.argv[1], sys.argv[2]
xml = open(path, encoding='utf-8', errors='ignore').read()
for m in re.finditer(r'<node [^>]*>', xml):
    n = m.group(0)
    t = re.search(r' text="([^"]*)"', n); d = re.search(r' content-desc="([^"]*)"', n)
    vals = [(t.group(1) if t else '').strip(), (d.group(1) if d else '').strip()]
    if want in vals:
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if b:
            x1, y1, x2, y2 = map(int, b.groups())
            if x2 > x1 and y2 > y1:
                print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
)
  if [ -n "$xy" ]; then adb shell input tap $xy; sleep "${2:-4}"; return 0; fi
  echo "::warning::Turul nu a găsit butonul „$1”"; return 1
}

shot 00-bun-venit
tap_text "Start" 3 && shot 00b-pas2
tap_text "Later" 4
shot 01-azi
swipe_up; shot 02-azi-jos; swipe_up; shot 03-azi-jos2
tap_text "Gallery" && shot 04-galerie
swipe_up; shot 05-galerie-jos
tap_text "Clean up" && shot 06-curatenie
swipe_up; shot 07-curatenie-jos
tap_text "Studio" && shot 08-studio
swipe_up; shot 09-studio-jos
tap_text "Ask" && shot 10-intreaba
back
tap_text "Today" 3
tap_text "Settings" && shot 12-setari
tap_text "Cherrypic Pro" && shot 13-pro
swipe_up; shot 14-pro-jos
back; back
tap_text "Gallery"
# Prima poză din grilă, deschisă (vizualizarea unei poze și foaia de jos).
adb shell input tap $(( W * 17 / 100 )) $(( H * 33 / 100 )); sleep 4; shot 11-poza
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
