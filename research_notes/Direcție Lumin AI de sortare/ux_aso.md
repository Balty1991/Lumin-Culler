# UX blueprint and ASO plan for an Android "AI companion" daily photo culler (RO + EN)

Research note on method: this cloud session could not reach play.google.com, support.google.com, m3.material.io or blog.duolingo.com (DNS blocked), so the Play listings, Google's help pages, the M3 docs and the Duolingo blog could not be read in full. Findings below come from web search results (often secondary sources) plus a full read of developer.android.com. Where a claim rests on a secondary source, that is stated. No paid ASO tool data (search volume or difficulty) was available.

## 1. Best-in-class patterns: swipe triage, daily digests, AI companions, taste profiles, streaks and notifications

### Takeaway
The proven commercial pattern is Tinder-style binary swipe triage (Swipewipe, Slidebox), sold through an early paywall and grown virally on TikTok. Daily-ritual mechanics work when the daily unit is small and has a clear end (Duolingo's streaks). They decay when the daily prompt produces low-value content (BeReal). A "keep the best 3-5 of today's 20-40" ritual sits between the two: it is small and has a clear end, and its output (the best photos) is valuable in its own right.

### Cited Findings
- Swipewipe is a Tinder-like interface: users swipe right to keep a photo or video and left to delete it. It shows a paywall early in onboarding, and its whole model is a subscription that unlocks the full feature set — [Sensor Tower / Adapty summaries via search](https://adapty.io/paywall-library/photo-cleaner-swipewipe/); [Swipewipe UI breakdown](https://screensdesign.com/showcase/photo-cleaner-swipewipe)
- Swipewipe reports 10M downloads across the App Store and Google Play in Feb 2025 and 25M+ by Aug 2026 (developer's own numbers) — [Swipewipe story](https://swipewipe.com/story)
- Third-party revenue estimates for Swipewipe range from about $400k to about $1M per month. These are modelled estimates and the sources differ — [Sensor Tower](https://app.sensortower.com/overview/1583884012?country=US); [MWM page](https://mwm.ai/apps/photo-cleaner-swipewipe/1583884012)
- MWM acquired Swipewipe in June 2024. The app had gone viral with Gen Z, partly through TikTok, and MWM projected more than €10M in iOS revenue for that year, largely from Swipewipe subscriptions — [TechCrunch](https://techcrunch.com/2024/06/25/gen-z-photos-app-swipewipe-sells-to-french-publisher-mwm-in-its-largest-acquisition-to-date)
- Slidebox's Play listing title is "Slidebox - Photo Cleaner" (package co.slidebox). Its core interaction is swipe-up-to-delete while scrolling through the camera roll — [Google Play listing (search result)](https://play.google.com/store/apps/details?id=co.slidebox&hl=en_US); [PixPlan](https://www.thepixplan.com/blog/swipe-up-to-delete-photos-easily-with-slidebox)
- Duolingo has run more than 600 experiments on the streak feature over 4 years — [Lenny's Newsletter](https://lennysnewsletter.com/p/behind-the-product-duolingo-streaks)
- Duolingo reportedly saw retention rise sharply once users reached a 7-day streak, which it attributes to loss aversion. This comes from a summary of a Lenny's podcast interview with the retention PM — [podcast summary](https://podcasts-distilled-hugo-content.pages.dev/lennys-podcast-product-career-growth/behind-the-product-duolingo-streaks-jackson-shuttleworth-group-pm-retention-team/)
- Allowing two Streak Freezes at once raised daily active learners by 0.38%, and a new streak animation raised day-7 retention of new learners by 1.7%. Both figures come from a secondary summary of Duolingo blog posts — [Lazyweb summary](https://www.lazyweb.com/research/duolingo-retention-experiments.md); [Duolingo blog: streak research](https://blog.duolingo.com/duolingo-streak-research/)
- Duolingo says widget users stay active longer, even after controlling for the fact that people who add widgets are more engaged to begin with. It gives no percentage. A "60% commitment increase from iOS widgets" figure circulates, but only on a Smashing Magazine mirror, unverified — [Duolingo widget post](https://blog.duolingo.com/duolingo-widget-feature/); [Smashing mirror](https://briefly-prod.herokuapp.com/anchor/UX_design/story/designing-a-streak-system-the-ux-and-psychology-of-streaks---smashing-magazine)
- Duolingo's streak-saver notification ("your streak is about to end") is described as the first significant win in its streak optimisation. A timing of about 23.5h after the last session is widely repeated, but no published experiment backs it — [Substack case study](https://marishalakhiani.substack.com/p/breaking-down-duolingos-growth-model); [Taplytics](https://taplytics.com/blog/how-duolingo-ran-an-experiment-on-their-streaks-feature)
- BeReal sends one notification a day at a random time, with a 2-minute window. Usage fell sharply after the 2022 peak (sources conflict on figures). The company claimed 20M to 25M DAU in Sept 2023. Critics argue that random-moment photos are less interesting than curated ones, and that one post a day gives little reason to return. Voodoo acquired BeReal in June 2024 for about €500M — [Wikipedia](https://en.wikipedia.org/wiki/BeReal); [TechCrunch](https://techcrunch.com/2023/09/29/bereal-pushes-back-at-report-that-its-losing-steam-says-it-now-has-25m-daily-users); [PetaPixel](https://petapixel.com/2023/02/22/bereal-may-be-on-the-out-users-have-nearly-halved-since-peak); [Dazed](https://www.dazeddigital.com/life-culture/article/61166/1/why-did-bereal-fail-social-media-instagram-authenticity)
- Android notification opt-in fell after Android 13 introduced the runtime POST_NOTIFICATIONS permission. Batch reports a drop from 85% to 67% within a year. Airship's Android median went from 71.3% (2023) to 59.5% (2024) to 53.3% (2025) — [Batch benchmark](https://batch.com/blog/case-studies/benchmark-notifications-push-crm-mobile); [Airship 2026 benchmarks](https://www.airship.com/mobile-app-push-notification-benchmarks-for-2026/)
- Batch's older (2023-data) benchmark found 6 pm the best open-time on average (6.7% open rate across industries) and Monday and Tuesday the best days — [Batch](https://batch.com/blog/case-studies/benchmark-notifications-push-crm-mobile)

### Inferences
- **Daily ritual design.** Make the daily session finite and satisfying, like Duolingo's single lesson: "Today: 27 photos, 4 suggested keepers, about 60 seconds". Avoid BeReal's failure mode by making sure the output has value (a curated "best of today" strip, ready to share).
- **Notification timing.** Default to one evening notification (about 19:00 to 21:00 local, when the day's photos exist and the 6 pm open-peak is near). Fire it only if there are new photos today, never on empty days. Then adapt the time per user to when they last opened the app (the Duolingo-style "last active time" heuristic). Also offer a "streak-saver" variant late in the evening, only for users with an active streak of 3 days or more.
- **Notification opt-in.** Because Android 13+ opt-in is around 53-67%, ask for notification permission in context: after the first completed daily cull ("Want me to have tomorrow's picks ready at 8 pm?"), not at launch.
- **Streak design.** Use a forgiving streak: a free "rest day" or freeze, a streak that counts days with no new photos as automatically kept, and a weekly target rather than a strict daily one. A photo-utility app cannot demand photos every day.
- **Widget.** A home-screen widget (Glance) showing "Today's best" or "4 picks waiting" is likely high-leverage, based on Duolingo's widget experience.
- **Competitive gap.** Swipewipe and Slidebox are pure delete-cleaners. "Keep the best 3-5" plus "learns your taste" is a distinct value proposition: curation rather than storage cleanup.

### Gaps
- No primary data found on Replika's onboarding (avatar and personality setup) or Apple Journal suggestion UX. Patterns are known from general knowledge but not sourced here.
- No primary data on Google Photos Memories engagement, or on Spotify Wrapped and Netflix taste-profile design decisions.
- Retention impact of streaks for *utility* (non-learning) apps: no sourced study found.
- Could not open the Play listings for Slidebox or Swipewipe (play.google.com blocked), so their exact short descriptions, categories, ratings and screenshot captions are unknown.

## 2. Material 3 Expressive, motion and what feels "ultra-modern and professional" on Android in 2026

### Takeaway
Material 3 Expressive (announced May 2025, shipped with Android 16) is Google's own current reference. It brings spring-based motion physics, shape morphing, bolder type and colour, and new components. Google's research claims faster recognition of key elements and strong preference among young users. Building on it (Compose Material3 expressive APIs) is the shortest route to "feels native and modern".

### Cited Findings
- Google ran 46 studies with more than 18,000 participants. In eye-tracking, participants spotted key UI elements up to 4x faster in M3 Expressive than in Material 3. Older participants spotted key elements as fast as younger ones — [Dezeen](https://www.dezeen.com/2025/05/28/google-ushers-in-age-of-expressive-interfaces-with-material-design-update/amp/); [Fast Company](https://www.fastcompany.com/91333562/google-maximalist-new-material-design-kit)
- Users preferred the expressive designs across age groups, and Gen Z (or 18-24, depending on the source) chose the more maximalist screens 87% of the time. Sources are inconsistent on which age group the 87% applies to — [Fast Company](https://www.fastcompany.com/91333562/google-maximalist-new-material-design-kit); [Futura-Sciences](https://www.futura-sciences.com/tech/actualites/technologie-oups-fuite-devoile-prochaine-interface-android-121743/)
- The research combined eye tracking, surveys, focus groups and usability studies — [Droid-Life quoting Google](https://www.droid-life.com/2025/05/05/material-3-expressive-might-be-the-future-of-android-design/)
- M3 Expressive introduces a spring-based motion system meant to make interactions more fluid and natural. Developers can use these springs through updated Material motion APIs — [Android Authority](https://www.androidauthority.com/google-material-3-expressive-features-changes-availability-supported-devices-3556392/)
- Community guidance (not official) says to use springs (stiffness and damping) for spatial motion such as position, size and scale. Easing and duration still apply for enter/exit and shared-axis transitions. Springs should collapse to a fade or instant change when reduced motion is on — [community M3 motion skill](https://skills.sh/ahmed3elshaer/everything-claude-code-mobile/m3-expressive); [Koder motion physics spec](https://meta.koder.dev/specs/themes/motion/physics/)

### Inferences
- **Navigation.** Use a single-screen "Today" flow as the hero, plus a small bottom navigation bar (3-4 destinations: Today / Library or Sort / Taste profile / Settings). The existing v3 four-tab design fits this. Use the M3E floating toolbar or button group for the triage actions (Keep / Skip / Favourite) instead of loose icons.
- **Motion vocabulary.**
  - Swipe cards follow the finger 1:1, and on release use a spring with medium-low stiffness and slight overshoot.
  - The card rotates a few degrees with drag distance.
  - The background tints green (keep) or neutral grey (skip). Avoid red "delete" semantics in daily mode, because the action is "not today's best" rather than "destroy".
  - Shape morphing serves as the "AI is thinking" loading indicator (M3E loading indicator).
  - A shared-element transition takes the chosen photos into the "Today's best" strip.
- **Haptics.** A light tick when a card crosses the decision threshold, a confirm click on commit, and a stronger "success" pattern when the daily set is complete. Respect the system haptics setting.
- **What reads as "professional" in 2026.** Dynamic Color support with a brand fallback, edge-to-edge layout (mandatory on targetSdk 35+), predictive back gesture support, large expressive headline type on Today, generous corner radii (M3E shape scale), and reduced-motion support.

### Gaps
- Official m3.material.io motion tokens (exact spring stiffness and damping values for the "standard" and "expressive" motion schemes) could not be retrieved (domain blocked). Check them in the Compose `MotionScheme` API docs.
- No sourced data on haptics' measurable impact on retention or satisfaction.

## 3. Trust UX for destructive actions on Android (undo, trash, confirmation, MediaStore)

### Takeaway
On Android 11+ a third-party app cannot silently delete other apps' photos. It must use `MediaStore.createTrashRequest()` or `createDeleteRequest()`, which show a system consent dialog, unless the user grants the special MANAGE_MEDIA ("Media management apps") permission on Android 12+. The best UX combines two things: the app's own soft-delete ("Skipped" pile with undo, committed in a batch), and one system trash request per session, with copy explaining that items go to the system trash and stay recoverable.

### Cited Findings
- `createTrashRequest()` asks the user to place the files in the device's trash. Items in the trash are permanently deleted after a system-defined time period. `createDeleteRequest()` deletes permanently and immediately, with no trash step — [Android Developers: Access media files](https://developer.android.com/training/data-storage/shared/media)
- After calling these methods, the system builds a PendingIntent, and the user sees a dialog asking consent to modify or delete the specified files. Batch requests are available on Android 11 (API 30)+ — [Android Developers](https://developer.android.com/training/data-storage/shared/media); [API 30 diff](https://developer.android.com/sdk/api_diff/30/changes/android.provider.MediaStore)
- Only the OEM's preinstalled gallery can set `IS_TRASHED` directly without a dialog — [Android Developers](https://developer.android.com/training/data-storage/shared/media)
- On Android 12+ (targetSdk 31+), an app can ask for the MANAGE_MEDIA special permission. Steps: declare it, show UI explaining why, then launch `ACTION_REQUEST_MANAGE_MEDIA`, which opens the "Media management apps" settings screen. With it, trash, delete and write requests skip the per-request prompt — [Android Developers](https://developer.android.com/training/data-storage/shared/media); [AOSP commit](https://gitlab.e.foundation/e/os/android_frameworks_base/-/commit/8017e2b6dde255b2bb3f21e369b3f5d27e4f3d6e)
- `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` are restricted to use cases in Google Play policy, and Google recommends the photo picker where possible. On Android 16 (targetSdk 36), users who choose "limit access to selected media" see app-owned photos preselected in the picker — [Android Developers](https://developer.android.com/training/data-storage/shared/media)
- Reported bug: `createTrashRequest` fails for images on SD cards (status of fix unconfirmed) — [coderapp mirror of StackOverflow](https://coderapp.vercel.app/answer/79232743)
- UX consensus (attributed to NN/g, but via secondary sources): prefer undo over confirmation for reversible actions, and reserve modal confirmation for irreversible, high-consequence actions. When users perform many destructive actions in a row, batch them into one undo toast. No controlled study comparing the two was found — [UX Planet](https://uxplanet.org/confirmation-dialogs-how-to-design-dialogues-without-irritation-7b4cf2599956); [DEV Community](https://dev.to/137foundry/how-to-choose-between-confirmation-dialogs-undo-windows-and-soft-delete-patterns-1opj); [Andy Matuschak](https://notes.andymatuschak.org/zXH4ASvHNz488hCNgrBjQJK)

### Inferences
- **Three-layer safety model.**
  1. Swiping only marks a photo: an in-app "Skipped" state with an inline undo chip (shake-to-undo or tap the last card).
  2. At the end of the session, a review screen ("Move 23 to trash · free 180 MB") triggers one system trash request covering the whole batch.
  3. The system trash keeps items for the OEM-defined period. Tell users: "Recoverable from your Gallery trash".
- **Defaults.** Never use `createDeleteRequest` (permanent) by default. Offer it only as an explicit "Empty now" action.
- **MANAGE_MEDIA.** Ask for it only after the user has done 2-3 sessions and has seen the system dialog repeatedly ("Skip this confirmation every time?"). That earns trust before the settings detour.
- **Permission scope.** Because READ_MEDIA_IMAGES is policy-restricted, the Play Console permission declaration must justify full-library access ("core functionality: photo organisation and gallery management"). Handle partial (user-selected) access gracefully with an "Allow all photos for daily picks" upsell screen.
- **Copy.** In daily mode, never use "delete" for the swipe action. Use "Keep" / "Not today", so the mental model is curation, not destruction.

### Gaps
- Exact system trash retention (commonly said to be 30 days) is not stated on developer.android.com, which says only "system-defined". It may vary by OEM. Not verified.
- No data on what share of users grant MANAGE_MEDIA.

## 4. ASO: keywords, competitor titles, listing constraints, screenshots, category (RO + EN)

### Takeaway
Play limits: title 30 characters, short description 80 characters. Google advises unique titles and warns against common or promotional terms. Competitors lead the title with the generic head term "Photo Cleaner" (Swipewipe: "Photo Cleaner: Swipewipe"; Slidebox: "Slidebox - Photo Cleaner"). "Photo cleaner" is therefore the competitive head term in EN. A curation-led app should pair a brand with a differentiated descriptor ("best photos", "AI picks") and still rank for "photo cleaner" through the description. The first 3 screenshots carry most of the conversion weight.

### Cited Findings
- The title must be 30 characters or less. Make it unique and avoid common terms. The short description conveys the app's message in 80 characters or less (spaces count) and can appear outside the listing — [Google Play Console Help: store listing best practices](https://support.google.com/googleplay/android-developer/answer/13393723?hl=en) (via search snippet; page itself blocked); [trysonar summary](https://trysonar.app/blog/google-play-short-description)
- Competitor titles: "Photo Cleaner: Swipewipe" and "Slidebox - Photo Cleaner" — [Swipewipe Play listing](https://play.google.com/store/apps/details?id=com.afternoonproducts.swipewipe&hl=en); [Slidebox Play listing](https://play.google.com/store/apps/details?id=co.slidebox&hl=en_US)
- Google Play requires at least 2 screenshots and allows up to 8 per device type. The first three are the most important because users seldom scroll further and they are often the only visuals shown in search and featured placements. Lead with the core features and unique selling points, and A/B test through Play store listing experiments — [AppTweak](https://www.apptweak.com/en/aso-blog/how-to-optimize-your-app-screenshots)
- Only about 9% of users view all screenshots (secondary, unsourced stat) — [TechMagnate](https://www.techmagnate.com/blog/app-store-screenshots-optimization/)
- Average Google Play listing conversion in the US in H1 2024 was about 27.3% (AppTweak, cited second-hand) — [appscreens](https://appscreens.com/blog/screenshots-first)
- Romanian web search for "curățare galerie / poze duplicate" returned no Romanian-language competitor apps or content, only generic EN duplicate-photo articles (Gallery Doctor, Clone Buster mentioned). This suggests a thin localised competitive set — [search results, e.g. PhoneArena on Clone Buster](https://www.phonearena.com/news/Clone-Buster-for-Android-busts-some-duplicate-photos-on-your-file-system_id59475)

### Inferences (proposed listing, all lengths checked by hand, need verification in Play Console)
- **Category.** Photography rather than Tools. Inference: the competitive set of photo cleaners is mixed, and Photography fits a "best photos / curation" story better. Swipewipe's iOS category is Utilities and Slidebox's is "Photo & Video" per the MWM pages. The Play category could not be verified.
- **EN title options (≤30):**
  - "Lumin: AI Best Photo Picker" (27)
  - "Lumin – Photo Cleaner & Picks" (29)
  - Recommendation: test both in a Store Listing Experiment.
- **EN short description (≤80):**
  - "Keep your best shots every day. AI learns your taste & clears the rest." (71)
  - Alternative: "Swipe to keep your best photos. AI finds blurry & duplicate shots." (66)
- **RO title options (≤30):**
  - "Lumin: Cele mai bune poze AI" (28)
  - "Lumin – Curățare galerie AI" (27)
- **RO short description (≤80):**
  - "Păstrează zilnic cele mai bune poze. AI-ul îți învață gustul." (62)
  - Alternative: "Șterge pozele neclare și duplicate. Păstrează doar ce contează." (64)
- **Keyword clusters for the long description.** Google indexes the full description (repeat each term naturally 3-5 times; no stuffing).
  - EN: photo cleaner, clean up gallery, duplicate photos, similar photos, blurry photos, best photo picker, sort photos, organize photos, AI gallery, camera roll cleaner, free up storage, photo culling.
  - RO: curățare galerie, poze duplicate, poze similare, poze neclare (sau „blurate”), sortare poze, organizare poze, eliberează spațiu, cele mai bune poze, galerie AI.
- **First 3 screenshots:**
  1. Hero: "Your best 4 of today's 32 photos, picked in 10 seconds", with the Today card stack and AI badges.
  2. Swipe triage in motion: "Swipe to keep. AI does the rest."
  3. Taste profile: "It learns what you love" (radar or chips: faces, light, composition).
  - Screenshots 4-6 then cover: blurry and duplicate cleanup with MB freed, safe trash and undo ("Nothing is lost"), and use cases (sellers, parents, agents).
  - Use the same layout for RO, with localised captions and Romanian faces and contexts.
- **Use-case screenshots and copy for non-professional segments:**
  - Vinted/OLX sellers: "Pick the sharpest product shot from 15 tries".
  - Real-estate agents: "Best angle of every room".
  - Parents: "The one where everyone's eyes are open".
  - Creators: "Today's post-ready picks".
- **Avoid in titles.** "Best", "#1", "free" and emoji. Google policy restricts promotional or performance claims in titles and icons. This comes from general knowledge of the 2021 Play metadata policy; the policy page could not be fetched.

### Gaps
- No search-volume or difficulty data for any EN or RO keyword. Requires AppTweak, Sensor Tower, AppFollow or the Google Ads Keyword Planner, none of which were reachable. Treat keyword prioritisation as a hypothesis.
- Exact Play categories, short descriptions, ratings and download bands for Slidebox, Swipewipe, Google Files, Gallery Doctor and Cleanup-style apps could not be read (play.google.com blocked).
- Romanian-language competitor listings are unknown. Check them manually on Play with the RO locale.
- The Play Console Help Center's current screenshot specs (aspect ratio, minimum 320px, maximum 3840px, and the "4 screenshots at 1080px or more for promotion eligibility" rule) are not verified in this session.
