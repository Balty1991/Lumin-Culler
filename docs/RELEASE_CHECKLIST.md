# Release checklist — Lumin cleaner 3.1.0

What is already in the repo, and what only you can do on a device or in Play Console.
The store text is in [PLAY_LISTING.md](PLAY_LISTING.md). Do not paste [PLAY_STORE_LISTING.md](PLAY_STORE_LISTING.md); that file is the older culler wording.

## Already in the repo

- Native cleaner is the launcher (`CleanerActivity`). The Capacitor WebView (`MainActivity`) is `exported=false` and is not opened from the cleaner.
- Play Billing client queries the three product ids, launches the purchase, restores, and acknowledges. Prices on screen come only from Play.
- Free tier matches `src/core/aiCleanAllowance.ts`: seeing the gigabytes is free, swipe-one is free, the first full pile is free, then 50 items a day. The cap is applied only after Play has answered, at least one product exists, and the user is not Premium.
- Default delete on Android 11+ is system Trash (`createTrashRequest`), with undo. “Free the space now” is a second step (`createDeleteRequest`). No `MANAGE_EXTERNAL_STORAGE`. No `READ_MEDIA_AUDIO`.
- Weekly local reminder is scheduled when the cleaner starts if the switch is on. It writes the suggested reclaimable bytes. It does not delete.
- In-app review is requested once, after three successful Trash operations. Play may still not show the dialog.
- `versionName` is `3.1.0` in `package.json` and `android/app/build.gradle`. `versionCode` 5 in Gradle is for local builds only.
- Release signing reads `android/app/keystore.properties` when that file exists. The example file has placeholders. Neither the keystore nor real passwords are in git. `minifyEnabled` stays false.
- JVM unit tests for rescue, allowance, access, and baskets: `./gradlew :app:testDebugUnitTest` (21 tests, after `bash android/scripts/ensure-cordova-stub.sh` if you have not run `cap sync`).
- Web tests: `npm test` (typecheck and lint are the PR workflow).

## Do not do

- Do not merge or build on `ccr-11a987f1-5bryqk`. That branch sends photos to a cloud model and contradicts the on-device promise and the Data safety form.
- Do not upload an AAB whose `versionCode` is less than or equal to the one already in Play Console. The local `versionCode` 5 is documentation. Play already has codes in the high 30s from `.github/workflows/release-android.yml`, which replaces `versionCode` with `GITHUB_RUN_NUMBER` and `versionName` with the tag (or `package.json` on a manual run). Upload the AAB from that Action.
- Do not turn R8 on for this release. Store builds with `minifyEnabled true` closed during analysis; the file comments record that.
- Do not put a weekly product in Play. Do not type the dollar amounts into the app.
- Do not request all-files access or audio access to “finish” voice notes.

## 1. Keystore and GitHub secrets

If this app is already in Play, use the existing upload key. Do not generate a second one.

If you still need a key, generate it on your own machine and back it up (password manager plus an offline copy):

```
keytool -genkey -v -keystore lumin-culler-release.jks -alias lumin-culler -keyalg RSA -keysize 2048 -validity 10000
```

Play App Signing should stay on, so Google holds the app signing key.

GitHub Actions secrets, if they are not already set:

- `ANDROID_KEYSTORE_BASE64` — `base64 -w0 lumin-culler-release.jks`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Optional local file, gitignored: copy `android/app/keystore.properties.example` to `android/app/keystore.properties` and fill the real values. A local release build without that file is unsigned.

## 2. Play Console products

Create these ids. They must match `src/core/suggestedPrices.ts` and `PremiumIds.kt`.

| Product id | Kind | Suggested base price |
|---|---|---|
| `lumin_premium_yearly` | Subscription, yearly base plan | 19.99 USD / 79.99 RON |
| `lumin_premium_lifetime` | One-time product | 34.99 USD / 139.99 RON |
| `lumin_premium_monthly` | Subscription, monthly base plan | 4.99 USD / 19.99 RON |

On the yearly base plan, add a 7-day free offer. That is an offer, not a fourth product id.

Other countries: start from Play’s price template, then check that yearly is the obvious deal and lifetime is about 1.7× yearly.

Add license testers. Billing does not complete on a debug sideload; test purchases on a signed build from a closed track, with a license-tester account.

## 3. Build the AAB

1. Merge this branch only after you accept it.
2. Actions → “Build signed Android release” → Run workflow, or push a tag `v3.1.0`.
3. Download the AAB from that run’s artifacts.
4. Confirm the run log shows a `versionCode` higher than the one already in Play. If this workflow’s `GITHUB_RUN_NUMBER` is still lower, do not upload it; run the workflow again only after you understand which number Play has, and do not hand-edit a lower code into an upload.

Closed testing: upload that AAB to a closed track before production. Open testing and production come after the device list below passes on the signed build.

## 4. Device tests

Use a phone with a real gallery, not an emulator screenshot as proof. Cover at least one Android 14 device and, if you have it, one Android 10 device.

- Full photo and video access. Rescue shows a gigabyte total before every thumbnail is done. Large videos (over 50 MB), chat folders, and screenshots appear from metadata.
- Android 14 “select photos” (limited access) is not treated as a total denial. “Choose more photos” asks again. Only the selected items are listed.
- Deny photos. The allow-photos screen stays. Nothing is deleted.
- Videos are a separate grant on Android 13+. Denying videos leaves the video pile empty and shows the allow-videos line. Granting it fills videos over 50 MB.
- A large gallery (thousands of photos) stays responsive: the first number appears from metadata, then sharpness, then eyes only inside bursts and near-duplicates. Eyes are capped (240 frames). If the face pass has not finished, the reason line omits eyes rather than inventing them.
- Review screen: suggested items are checked, unique chat photos and screenshots from the last 7 days are not. Uncheck one. Confirm. Android’s dialog appears. Cancel it. The allowance counter does not move and the files stay.
- Accept Trash. Result says the space is still used. Undo puts the files back and restores the allowance.
- “Free the space now” shows Android’s permanent-delete dialog. Accepting it increments the freed counter. Share says “I freed”, not “I set aside”. After Trash alone, share says “I set aside”.
- First full pile is free at any size. The next day of one-tap cleans stops at 50 items, largest first, and the button opens the paywall for the rest. This lock appears only after the three products exist and Play has answered. Before that, cleaning stays open. Premium removes the cap. Restore purchases on a second install of the same signed build returns Premium without a second charge. Airplane mode after a successful unlock keeps the local premium flag.
- Turn the reminder on. Android 13+ asks for notification permission. The switch stays honest: on means WorkManager has the 7-day job named `lumin-monthly-clean`. The notification does not delete anything. You cannot force the 7-day fire in one sitting; check that the work is scheduled (App info, or a debug log) rather than waiting a week.
- In-app review may not appear. After three successful Trash operations the app asks Play once. Play decides whether to show it. There is no “do you like the app?” step before that.
- Android 10, if you have a device: there is no Trash. The review screen says the delete is permanent, and the system confirms one file at a time. Do not expect undo.
- Android 8–9, if you have a device: the app asks for write access and the delete is permanent.

## 5. Store listing and policy forms

- Paste title, short description, and full description from [PLAY_LISTING.md](PLAY_LISTING.md), English and Romanian. Do not paste the internal comparison table.
- Capture the seven screenshots listed there on a signed build with your own photos.
- Data safety: answer “no data collected or shared”, using the table in that file. Be ready to explain `ACCESS_MEDIA_LOCATION`: it is still declared for the unused photographer tools, the cleaner never requests it, and location is not read or sent. Do not tick location as collected. `INTERNET` is for Play Billing only.
- Content rating: no ads, no user-generated public sharing, photos stay on device. Answer the questionnaire from the app you are shipping, not from an old “social” template.
- Privacy policy URL: `https://balty1991.github.io/Lumin-Culler/privacy-policy.html`. Open it after the next Pages deploy and confirm it still says on-device, no account, no ads.

## 6. Intentionally not in this Play surface

- Eyes-closed as its own basket. Eyes are a reason inside a burst or near-duplicate, and only for the capped set.
- Video compression. The plugin remains for the dormant web tools. The cleaner does not mention it.
- Voice notes and stickers that MediaStore does not index.
- A cloud model. Do not ship the Cloudflare branch.
