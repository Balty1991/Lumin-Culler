# Play listing — Lumin cleaner

Launcher name stays **Lumin**. Package stays `com.luminculler.app`.
Primary listing language: English. Romanian is the second store listing.

Do not paste dollar amounts into the public description. Play shows the
price for the buyer’s country, and the app draws only that string.
Do not name other apps in the public description.

Character counts below are Unicode characters, checked against Play’s limits
(title 30, short description 80, full description 4000).

## Title and short description

| Locale | Title | Short description |
|---|---|---|
| en-US | `Lumin: AI Photo Cleaner` (23) | `See the fastest way to free space. Best shot stays. No ads, on your phone.` (74) |
| ro-RO | `Lumin: Eliberează Spațiu` (24) | `Vezi ce eliberează spațiu cel mai repede. Cadrul bun rămâne. Fără reclame.` (74) |

## Full description (en-US)

```
Lumin shows the fastest way to free space, then waits for you to confirm.

Storage full
Open the app and see how many gigabytes you can free. Piles are ordered by how much space you get for each second of your time: large videos, chat media, duplicates, old screenshots, extra burst frames, and blurry photos. The same file is counted once.

Best shot stays
In a burst or a near-duplicate series, Lumin keeps the sharper frame, the one with eyes open, and the better exposure, and tells you why. The rest is a suggestion. You uncheck anything you want to keep.

Chats
WhatsApp, Telegram, and Messenger photos and videos that Android already shows in your gallery can be reviewed together: statuses, stickers, GIFs, and copies of a photo you already have in the camera roll. A chat photo that is the only copy stays unchecked. Voice notes are not scanned.

Nothing disappears in silence
Every clean opens a review screen. On Android 11 and later, files go to the system Trash first. Trash lasts about 30 days, and Undo puts them back. Trash does not free space until it is emptied. “Free the space now” permanently deletes only what you just reviewed, and Android shows its own confirm dialog. On older Android there is no Trash, and the app says the delete is permanent.

On this phone
Photos, videos, and faces are processed on the device. No account. No ads. No tracking. The only network use is Google Play, to show the price and to check a purchase.

Free, then Premium
Seeing the gigabytes is free. Swiping one photo at a time is free. The first full clean is free, however large it is. After that, 50 items a day stay free. Premium removes the daily cap. Plans are yearly (with a free trial when Play offers one), lifetime, and monthly. There is no weekly plan. The price on screen is the one Google Play returns for your country. You cancel in Google Play.
```

## Full description (ro-RO)

```
Lumin arată cel mai rapid mod de a elibera spațiu, apoi așteaptă confirmarea ta.

Stocare plină
Deschizi aplicația și vezi câți gigabytes poți elibera. Grămezile sunt ordonate după cât spațiu obții pentru fiecare secundă: videoclipuri mari, media din chat, duplicate, capturi vechi, cadre în plus din rafală și poze neclare. Același fișier e numărat o singură dată.

Cadrul bun rămâne
Într-o rafală sau într-o serie aproape identică, Lumin păstrează cadrul mai clar, pe cel cu ochii deschiși și pe cel cu expunerea mai bună, și îți spune de ce. Restul e o sugestie. Debifezi ce vrei să păstrezi.

Chat-uri
Pozele și videoclipurile din WhatsApp, Telegram și Messenger pe care Android le arată deja în galerie pot fi verificate împreună: statusuri, stickere, GIF-uri și copii ale unei poze pe care o ai deja în rolă. O poză din chat care e singura copie rămâne nebifată. Notele vocale nu sunt scanate.

Nimic nu dispare în tăcere
Fiecare curățare deschide un ecran de verificare. Pe Android 11 și mai nou, fișierele merg întâi în Coșul sistemului. Coșul ține cam 30 de zile, iar Anulează le pune înapoi. Coșul nu eliberează spațiu până nu e golit. „Eliberează spațiul acum” șterge definitiv doar ce tocmai ai verificat, iar Android își arată propriul dialog. Pe Android mai vechi nu există Coș, iar aplicația spune că ștergerea e definitivă.

Pe telefonul ăsta
Pozele, videoclipurile și fețele sunt prelucrate pe dispozitiv. Fără cont. Fără reclame. Fără urmărire. Singura rețea e Google Play, ca să arate prețul și să verifice o cumpărare.

Gratuit, apoi Premium
Să vezi gigabytes e gratuit. Să glisezi câte o poză e gratuit. Prima curățare completă e gratuită, oricât e de mare. După ea, 50 de elemente pe zi rămân gratuite. Premium scoate plafonul zilnic. Planurile sunt anual (cu perioadă de probă când Play o oferă), pe viață și lunar. Nu există plan săptămânal. Prețul de pe ecran e cel pe care îl întoarce Google Play pentru țara ta. Anulezi în Google Play.
```

## Screenshots to capture on a device

Play needs phone screenshots from a signed build, not a mock. Capture in this order, with photos that are yours:

1. Rescue home: the “X GB you can free” line, the promise line, and the first pile marked Fastest.
2. Swipe deck: one photo, Trash on the left, Keep on the right.
3. Review of a burst or duplicates, with the “we keep …” line and a reason (sharper, eyes open, or exposure).
4. Large videos pile, with the size of each file visible.
5. Result after Trash: “in Trash”, “space is still used”, Undo, and Free the space now.
6. Paywall after the three products exist in Play: yearly highlighted, lifetime, monthly, prices coming from Play, restore.
7. Permission state: either the allow-photos screen, or Android 14 limited access with “Choose more photos”.

Do not ship a screenshot that shows a hardcoded price, an empty Play error, or another app’s name.

## Data safety (answer to match this code)

The cleaner does not transmit photos, videos, faces, or a usage log. There is no account, no analytics SDK, and no advertising ID.

| Form question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | No |
| Photos and videos | Processed on device with MediaStore. Not uploaded. Not “collected”. |
| Audio | Not accessed. `READ_MEDIA_AUDIO` is not requested. Voice notes are not scanned. |
| Files and docs | Only gallery images and videos the user grants. No all-files access. |
| Location | Not collected and not shared. `ACCESS_MEDIA_LOCATION` remains in the manifest for the unused photographer tools (`MainActivity`, not a launcher, `exported=false`). The cleaner never requests it and never reads GPS. If Play asks why the permission is declared, say that. Do not tick location as collected. |
| Financial info / purchase history | Handled by Google Play. The app stores a local premium flag. No card data, no server receipt. |
| Device or other IDs | Not collected. No advertising ID. |
| App interactions / diagnostics | Not collected. |
| Data encrypted in transit | If the form still asks: yes for the Play Billing connection. The app has no server of its own. |
| Account creation | Users can use the app without an account. |
| Data deletion request URL | Not required when nothing is collected. Users delete their own files through Android’s dialog. |

`INTERNET` is declared because Play Billing needs it. Say that in any “why does this app use the network?” note. Do not add a privacy-policy sentence that claims photos are uploaded.

Privacy policy already published with the PWA: `https://balty1991.github.io/Lumin-Culler/privacy-policy.html`. Re-read it before the release and confirm it still says on-device processing, no ads, no account.

## Pricing to create in Play Console

These numbers are the ones in `src/core/suggestedPrices.ts`. They are not drawn in the app.

| Product id | Type | Suggested price | Notes |
|---|---|---|---|
| `lumin_premium_yearly` | Subscription, base plan yearly | 19.99 USD / 79.99 RON | Highlighted in the app. Add a 7-day free offer on this base plan. Not a fourth product. |
| `lumin_premium_lifetime` | One-time | 34.99 USD / 139.99 RON | About 1.7× yearly, so it is an exit from the subscription. |
| `lumin_premium_monthly` | Subscription, base plan monthly | 4.99 USD / 19.99 RON | Anchor. Shown, not highlighted. |

No weekly product. Other countries: Play’s price template, then round to a local price that still makes yearly the obvious deal. The paywall order is yearly, lifetime, monthly, using only the formatted price Play returns.

Free tier, enforced only after Play has answered and at least one product exists, and the user is not Premium:

- Scan and the gigabyte total: free.
- Swipe one by one: free, not counted.
- First full pile: free, any size.
- After that: 50 items per day. A partial day deletes the largest files first.
- If Play has no products, the cap is not applied.

## Internal — do not paste into Play

Positioning against the category, October 2026. Prices are public store listings, mostly iOS where the Android price was not re-checked in this pass. Sponge’s 2026 price was not verified; do not invent it.

| | Lumin | Swipewipe | Slidebox | Sponge | Remo | Files by Google |
|---|---|---|---|---|---|---|
| Rescue ranked by space per second of effort | Yes | Swipe, not ranked that way | No | Not verified | No | Large files, not ranked by effort |
| WhatsApp / Telegram / Messenger, safe defaults | MediaStore images and videos. Unique chats stay unchecked | Not the product | Limited | Not verified | WhatsApp photos group | Some WhatsApp junk |
| Best shot with eyes and a written reason | On burst and near-duplicate clusters | Similar / blurry; eyes are weak | No | Not verified | No | No |
| Review, then Trash, then a separate permanent delete | Yes. Undo while in Trash | Varies | Varies | Not verified | Review before delete | System confirm |
| Offline, no account, no ads, no tracking, said on screen | Yes. Network is Play Billing only | Contains advertising | Check the current listing | Not verified | Ads; processing on device | Free, no IAP |
| Price shape | Yearly with 7-day trial, lifetime, monthly. No weekly | Weekly about 3.99–9.99 USD, yearly about 29.99 | Weekly about 1.99–2.99, monthly about 4.99, yearly about 19.99–49.99, lifetime about 29.99–49.99 | Not verified | Yearly about 24.99, weekly about 1.99, ads | Free |

What this release actually does, and what it does not, is in the PR report. The public description only claims the first column where the code does that thing.
