#!/usr/bin/env bash
# Pornirea cade („You need to use a Theme.AppCompat theme”) dacă MainActivity
# cheamă installSplashScreen, iar tema de lansare nu spune ce temă urmează după splash.
set -euo pipefail
if grep -q "installSplashScreen" android/app/src/main/java/com/luminculler/app/MainActivity.java; then
  grep -q 'name="postSplashScreenTheme">@style/AppTheme.NoActionBar' android/app/src/main/res/values/styles.xml \
    || { echo "::error::AppTheme.NoActionBarLaunch nu are postSplashScreenTheme: aplicația cade la pornire."; exit 1; }
fi
echo "Tema de după splash: în regulă."
