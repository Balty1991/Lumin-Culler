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
# Partea a doua: pozele trimise către Cherrypic („Trimite”), ca să ruleze importul și
# analiza cu modelele native, partea care cădea când R8 a fost pornit prima dată.
PHOTOS_DIR="${3:-}"
if [ "$fail" = 0 ] && [ -n "$PHOTOS_DIR" ] && [ -d "$PHOTOS_DIR" ]; then
  adb shell mkdir -p /sdcard/Pictures/smoke
  for f in "$PHOTOS_DIR"/*.jpg; do adb push "$f" /sdcard/Pictures/smoke/ > /dev/null; done
  adb shell content call --method scan_volume --uri content://media --arg external_primary > /dev/null 2>&1 || true
  for f in "$PHOTOS_DIR"/*.jpg; do adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Pictures/smoke/$(basename "$f")" > /dev/null 2>&1; done
  sleep 5
  ids=$(adb shell content query --uri content://media/external/images/media --projection _id:_display_name | tr -d '\r' | grep "smoke-" | sed -E 's/.*_id=([0-9]+).*/\1/')
  echo "Poze în MediaStore: $(echo $ids)"
  if [ -z "$ids" ]; then
    echo "::warning::Pozele de test nu au apărut în MediaStore; partea cu importul e sărită."
  else
    # „Trimite către Cherrypic”, câte o poză (am nu poate trimite o listă de URI-uri).
    for id in $ids; do
      adb shell am start -a android.intent.action.SEND -t image/jpeg --eu android.intent.extra.STREAM "content://media/external/images/media/$id" -n "$PKG/.MainActivity" > /dev/null
      sleep 6
    done
    for i in $(seq 1 30); do
      sleep 5
      adb logcat -d > "$OUT/logcat.txt"
      grep -q "Cherrypic: shared import done" "$OUT/logcat.txt" && break
      grep -A30 "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -q "$PKG" && break
    done
    # Autotestul nativ (lumin/nativeSelfTest.ts, doar în build-ul de test): fețe (MediaPipe),
    # etichete (ML Kit), postură, decupare, pe fiecare poză trimisă. Până la 150 s.
    want=$(echo $ids | wc -w)
    for i in $(seq 1 30); do
      adb logcat -d > "$OUT/logcat.txt"
      [ "$(grep -c 'Cherrypic: selftest done' "$OUT/logcat.txt")" -ge "$want" ] && break
      grep -A30 "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -q "$PKG" && break
      sleep 5
    done
    # Analiza continuă după import: încă 30 s în care modelele native lucrează.
    sleep 30
    adb exec-out screencap -p > "$OUT/dupa-import.png" || true
    adb logcat -d > "$OUT/logcat.txt"
    if ! adb shell pidof "$PKG" > /dev/null; then echo "::error::Aplicația nu mai rulează după importul pozelor"; fail=1; fi
    if grep -A30 "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -q "$PKG"; then
      echo "::error::Aplicația a căzut la import sau la analiză:"; grep -A40 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -50; fail=1
    fi
    if grep -q "Cherrypic: shared import done" "$OUT/logcat.txt"; then echo "Importul pozelor trimise s-a terminat."; else echo "::error::Importul pozelor trimise nu s-a terminat în 150 s."; fail=1; fi
    echo "── Autotestul modelelor native ──"
    grep -o "Cherrypic: selftest .*" "$OUT/logcat.txt" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}" || true
    if ! grep -q "Cherrypic: selftest done" "$OUT/logcat.txt"; then
      echo "::error::Autotestul modelelor native nu s-a terminat (vezi mai sus)."; fail=1
    fi
    if grep -q "Cherrypic: selftest error" "$OUT/logcat.txt"; then
      echo "::error::Un model nativ a dat eroare în autotest (fețe, etichete, postură sau decupare)."; fail=1
    fi
    if ! grep -qE "Cherrypic: selftest (ok|partial) .*faces=[1-9]" "$OUT/logcat.txt"; then
      echo "::error::Autotestul nu a găsit nicio față în pozele de test (MediaPipe Face Landmarker)."; fail=1
    fi
    echo "── Etichetele ML Kit ale pozelor de test ──"
    grep -o "Cherrypic: labels: .*" "$OUT/logcat.txt" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}" || echo "(nicio etichetă în jurnal)"
    echo "── Urme ale modelelor native (ultimele rânduri) ──"
    grep -iE "onnx|tflite|litert|mediapipe|mlkit|Cherrypic|Capacitor/Console" "$OUT/logcat.txt" | tail -40
  fi
fi
if [ "$fail" != 0 ]; then
  echo "── Ce a scris aplicația (consola paginii, Capacitor, căderi) ──"
  grep -E "Capacitor|chromium|Console|Cherrypic|AndroidRuntime|WebView" "$OUT/logcat.txt" | grep -v "^-" | tail -120
fi
[ "$fail" = 0 ] && echo "Pornirea pe emulator: în regulă."
exit $fail
