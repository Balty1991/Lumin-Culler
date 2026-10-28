# Competitive landscape 2025-2026: consumer photo sorting / best-shot / personal-taste apps

Method note: research done via web search only. Direct fetches of play.google.com, pricingsaas.com, talkandroid.com and chatgate.ai failed (hosts are blocked in this session's network settings), so install counts come mostly from AppGoblin (third-party estimates). Search snippets were summarized by the search tool. Treat numbers as directional and confirm on the live store listings. No Romania-specific (RON) prices were found; the only EU price found is Gemini Photos/CleanMyPhone at 21.99 EUR/year.

## 1. Swipe-sorting, cleaner and best-shot apps (Android and iOS): what they do, prices, installs, complaints

### Takeaway
The consumer category is crowded with "cleaner" apps: swipe-to-delete, duplicate and similar-photo finders, and a few with an automatic "best shot" pick per group. They are built for one-off storage cleanup and monetize with weekly/annual subscriptions. Users complain mostly about weekly billing and trials that auto-convert. None of the large ones positions itself as a daily "pick my best photos" habit.

### Cited Findings
**Slidebox (Android + iOS, swipe sorting into albums or trash)**
- Android "Slidebox - Photo Cleaner": AppBrain lists 500K+ installs; AppGoblin estimates about 612,603 installs, about 1.9K/week — [AppBrain](https://www.appbrain.com/dev/Slidebox+LLC/), [AppGoblin](https://appgoblin.info/apps/co.slidebox)
- Freemium with a subscription — [AlternativeTo](https://alternativeto.net/software/slidebox/about)
- iOS in-app purchases: 1-week $1.99, 1-year $19.99, premium $19.99 (IAP range $1.99-$49.99). Android prices were not verified — [App Pricing Lab](https://apppricinglab.com/app/apple/984305203)

**Photo Cleaner: Swipewipe (MWM; Android + iOS)**
- Android: 4.41 stars from 5.2K ratings; ads plus IAP; trending, with monthly installs up by about 85.5K (AppGoblin) — [AppGoblin](https://appgoblin.info/apps/com.afternoonproducts.swipewipe)
- Paywall is documented in Adapty's paywall library (it is a subscription app) — [Adapty](https://adapty.io/paywall-library/photo-cleaner-swipewipe/)
- Long tail of Android swipe clones: Swipelit (82.2K installs, 3.75 stars), "Photo Cleaner: Swipe & Delete" (79.1K installs, 3.0 stars), Andropper (9.2K installs, 4.26 stars), Declutr, Swipee, SwipeSwoop and others — [AppGoblin Swipelit](https://appgoblin.info/apps/com.eco.photocleaner), [AppGoblin Swipe&Delete](https://appgoblin.info/apps/com.photo.cleaner.swipe2delete), [AppGoblin Andropper](https://appgoblin.info/apps/com.senforein.andropper), [AppGoblin Declutr](https://appgoblin.info/apps/com.zarnth.declutr)

**Remo Duplicate Photos Remover (Android + iOS)**
- Android: about 3.1M installs, 72.8K ratings, 4.28 stars, about 19.5K MAU, install trend steady (AppGoblin) — [AppGoblin](https://appgoblin.info/apps/com.remo.remoduplicatephotosremover/keywords)
- A second listing (likely iOS): 908.4K installs, 18.2K ratings, declining — [AppGoblin](https://appgoblin.info/apps/1066797785/keywords/ranking)
- Duplicate-finder category on Android is saturated: PicSweep, Duplicate Photos Fixer (Tweaking), Mobimaster and others — [AppGoblin PicSweep](https://appgoblin.info/apps/ee.simplesoft.picsweep), [AppGoblin Tweaking](https://appgoblin.info/apps/com.tweaking.duplicatephotofixer)

**Clever Cleaner (CleverFiles; iOS only)**
- Free, with no subscription or IAP (per reviews). It groups similar photos (not just exact duplicates, unlike Apple's built-in Duplicates album) and automatically picks a "Best Shot", marking the rest for deletion — [TheBusinessDive](https://thebusinessdive.com/?p=11442), [CleverFiles (vendor)](https://www.cleverfiles.com/howto/best-apps-to-delete-duplicate-photos-on-iphone.html), [App Store](https://apps.apple.com/app/id1666645584)
- Reviewers say its picks mostly make sense but are "occasionally off", so you still need a manual review — [HandyRecovery](https://www.handyrecovery.com/best-apps-to-delete-duplicate-photos-on-iphone/)

**Gemini Photos (MacPaw; iOS only), now sold inside "CleanMy®Phone: Careful Cleaner"**
- Prices vary by storefront: US $4.99/month, $19.99/year, $34.99 unlimited; Australia $60.99/year; EUR stores 21.99 EUR/year. A Romanian storefront listing exists, but no RON price was captured — [App Store US/CA](https://apps.apple.com/ca/app/id1277110040), [App Store RO](https://apps.apple.com/ro/app/id1277110040?l=ro)
- It picks the best of similar photos. Older reviews praise the UX but criticize the subscription: "a monthly subscription model is not a good fit for this given how rarely such an app gets used" (old, pre-2025) — [MacStories](https://www.macstories.net/?p=54359), [TapSmart](https://www.tapsmart.com/?p=21583)
- No evidence was found that it learns personal taste.

**Category-wide complaints**
- Weekly charges that annualize to hundreds of dollars for a duplicate finder; 3-day trials that auto-convert; hard cancellation — [Unstar 2026 cleaner ranking](https://unstar.app/pt-BR/blog/phone-cleaner-storage-apps-ranked-cleaner-kit-smart-cleaner-2026), [Trustpilot cleanup.pictures](https://www.trustpilot.com/review/cleanup.pictures)
- Reddit (r/Anticonsumption) frustration with long questionnaires and weekly fees before trying the app — referenced in [Unstar](https://unstar.app/blog/is-remini-legit-safe-photo-enhancer-app-reviews-2026) (indirect; no thread URL found)

### Inferences
- The incumbent model is "storage cleaner + weekly sub". It is episodic (used once when storage is full) and low trust. A daily-habit product with honest pricing (annual, or a lifetime option) would differentiate.
- An automatic best pick per similar-group is commodity: Clever Cleaner offers it free on iOS, and Google Photos and Samsung Gallery offer it natively. It cannot be the paid hook on its own.

### Gaps
- Exact Google Play prices for Slidebox, Swipewipe and Remo, plus RON/EU localized prices: the Play Store could not be fetched.
- Swipewipe total installs and current Play ratings for most apps (AppGoblin snapshots are undated).
- No apps named "Swipely" or "Photo Swiper" were found in this search.

## 2. Consumer apps that learn personal preference

### Takeaway
Personal-taste learning exists only in small, mostly iOS-first indie apps launched in 2025-2026 (SpectraSort, Cullour, Dewp, Topit). None has meaningful scale. On Android, no established app clearly learns taste from swipe decisions. That is the clearest gap.

### Cited Findings
- **SpectraSort (iOS 18.5+)**: "AI Sort" ranks by technical quality (sharpness, exposure, composition, color). "My Sort" builds a "Sort Style Profile" after about 30 swipes and then ranks by your taste. It is on-device (Apple Neural Engine, about 12 photos/sec) with no cloud and no account. Pricing: Premium $4.99/month, $29.99/year, $49.99 lifetime. Very few ratings — [App Store](https://apps.apple.com/us/app/id6757512134), [Product Hunt](https://www.producthunt.com/products/spectrasort-2/reviews), [AlternativeTo](https://alternativeto.net/software/spectrasort/about)
- **Cullour (iOS/iPad, ©2025)**: scans the library, surfaces the best shots, and "adapts to your unique style over time" (mechanism unspecified) — [App Store](https://apps.apple.com/cd/app/cullour/id6753363343)
- **Dewp**: flags duplicates, blur and blinks, then "learns your visual taste" to rank by style fit. Platform, date and price are unverified (its source page could not be fetched) — [chatgate.ai](https://chatgate.ai/post/dewp)
- **Topit**: claims to rank photos for the destination app (e.g. Instagram vs dating), learn your taste, collapse near-duplicates, and explain each pick. Available on iPhone, Android and web, free to start. Source is Topit's own domain (biased) — [mytopit.com](https://mytopit.com/ai-photo-selector)
- **Picker AI**: picks the photo likely to perform best on Instagram, LinkedIn or dating apps. Engagement-oriented, not personal taste — [Product Hunt](https://www.producthunt.com/posts/picker-ai)
- **HotShot: AI Photo Picker (Google Play)**: compares similar shots and picks one with "a clear reason why"; updated Oct 20, 2026. No personalization claim was confirmed — [Google Play](https://play.google.com/store/apps/details?id=com.hotshot.app&hl=en)
- **GoodOnes** (SF startup, raised $3.5M seed; AI picks keepers and declutters the camera roll; 2023, older) — [PetaPixel 2023](https://petapixel.com/2023/01/23/goodones-app-sifts-out-your-bad-pictures-recommends-the-good-ones); current status unknown
- **EyeEm "The Roll"/Selects (2019, older)**: curator-trained aesthetic scoring, not personal — [search summary via NVIDIA dev blog](https://developer.nvidia.com/new-app-automatically-identifies-your-best-photos)
- **Gemini Photos**: no evidence of personal learning (see section 1).

### Inferences
- The "learns your taste" claim is being made by several 2025-2026 iOS indies, so the positioning is not unique worldwide. But it is unproven at scale and largely absent on Android.
- SpectraSort's 30-swipe onboarding and lifetime price ($49.99) are a useful reference for the "Învață-mă" (Teach me) calibration and for pricing.

### Gaps
- Install and revenue data for SpectraSort, Cullour, Dewp and Topit (likely tiny; no tracker data found).
- Whether Topit's Android app actually exists on Play, and its install count.

## 3. Desktop pro culling tools: mobile versions? Pricing reference

### Takeaway
Pro AI culling (Aftershoot, Narrative Select, FilterPixel, Imagen) is desktop-first (Mac/Windows) and priced at roughly $5-15/month for culling alone, up to $45-55/month for full suites. No Aftershoot or Narrative mobile/Android culling app was found. The mobile pro-culling apps that exist are small iOS tools (PhotoPicker Pro, CullStudio, MWM "Cull") aimed at RAW and Lightroom workflows. Pro tools personalize ("AI Profiles" trained on your past edits and culls), but only for professionals.

### Cited Findings
- **Aftershoot**: desktop only (Windows/macOS), installed locally; no evidence of an iPhone or Android app in 2026 — [Aftershoot blog](https://aftershoot.com/blog/troubleshooting-tips-for-aftershoot/), [Aftershoot FAQ](https://aftershoot.com/culling-faq). Third-party directories claiming Android/iOS availability are unverified — [Creati.ai](https://creati.ai/ai-tools/aftershoot-com)
- Aftershoot 2026 modular pricing (sources conflict):
  - PricingSaaS: Select $15/month, Retouch $25, Edit $30, Complete $45 — [PricingSaaS](https://pricingsaas.com/companies/aftershoot)
  - PentaxRumors (June 2026): Select about $10/month annual or $15 monthly; Edit $30/$35; Retouch $20/$25; Complete $45/$55; plus a $10 AI Profile Bundle — [PentaxRumors](https://pentaxrumors.com/2026/06/06/aftershoot-the-workflow-is-now-complete-and-ai-that-works-for-you-not-against-you/amp/)
- **Narrative Select**: desktop; free tier (3 Pro project trial plus 1,000 Edit credits), though Narrative has also said free access is being scaled back as "no longer sustainable" — [Narrative help](https://help.narrative.so/en/articles/7337508-select-pricing-plans), [Narrative blog](https://narrative.so/blog/narrative-select-plans-are-changing). A competitor (Fovea) cites $10-60/month (unverified) — [Fovea](https://fovea-site.pages.dev/best-aftershoot-alternative-2026)
- **FilterPixel**: from $5/month (1,500 photos) to $12.50/month unlimited (SaaSworthy); older snapshot $8.99 — [SaaSworthy](https://www.saasworthy.com/product/filterpixel/pricing), [SpotSaaS](https://www.spotsaas.com/product/filterpixel/pricing)
- **Imagen**: FilterPixel's comparison page says Imagen starts at $19/month (vendor-biased) — [FilterPixel](https://filterpixel.com/imagen-ai-pricing)
- **Mobile pro culling apps**:
  - AI Culling — PhotoPicker Pro (iOS): blur, closed eyes, duplicates, expressions, motion; exports to Lightroom or Capture One — [App Store](https://apps.apple.com/us/app/-/id650580494)
  - PhotoPicker on Google Play: RAW culling, updated Aug 2026 — [Google Play](https://play.google.com/store/apps/details?id=app.photopicker&hl=en-US)
  - CullStudio (iOS 26+, free) — [App Store RO](https://apps.apple.com/ro/app/cullstudio/id6753145956)
  - MWM "Cull: AI Photo Culling" (iOS: sharpness, eyes, exposure, groups similar shots) — [mwm.ai](https://mwm.ai/apps/cull-ai-photo-culling/6787063558)
  - Keepers (iOS, "coming soon") — [Keepers](https://asmuelle.github.io/keepers/)
- SourceForge has a "photo culling apps for Android" category (March 2026), signalling that some Android entries exist — [SourceForge](https://sourceforge.net/software/photo-culling/android)

### Inferences
- The claim "the pro culling niche pays 10-15 USD/month, desktop only" is **largely correct**: culling-only tiers are about $5-15/month (FilterPixel $5-12.50, Aftershoot Select $10-15), and the major players are desktop-only. Caveats: full suites cost $30-55/month, and small mobile culling apps exist (mostly iOS, plus PhotoPicker on Android).
- Pro tools prove that people will pay for personalized AI selection, but they target pros with thousands of RAW files per shoot, not 20-40 phone photos a day.

### Gaps
- Official current Narrative Select price list (pricing page not fetched).
- Excire mobile status and Photo Mechanic pricing: not researched due to the tool-call budget. Photo Mechanic is not AI culling.

## 4. Do Google Photos / Samsung Gallery already solve best-of-burst and duplicates on Android?

### Takeaway
Partly. Google Photos "Photo Stacks" (since late 2023/Jan 2024) automatically groups near-duplicates and picks a "top pick", and Google was testing a per-day "Clean up this day" flow (blurry shots, duplicates, failed selfies) on Android in 2025-2026. Samsung Gallery groups similar images and shows a "best" one, and One UI 7 adds Best Face. None of these learns personal taste, explains its picks, or builds a daily "your best 3-5 of today" ritual. One user reported the pick being wrong "7 out of 10 times".

### Cited Findings
- **Google Photos Photo Stacks**: groups similar photos taken close together and selects a "top pick"; users can change the top pick, edit stacks, or turn it off (Settings > Preferences > "Stack similar photos"). Launched Nov 2023, rolled out widely Jan 2024 — [Google blog](https://blog.google/products-and-platforms/products/photos/google-photos-organization-updates-november-2023/), [PiunikaWeb](https://piunikaweb.com/2024/01/23/google-photos-photo-stacks-rolling-out-widely/), [Android Central](https://www.androidcentral.com/apps-software/google-photos-reminder-integration-photo-stacks-rollout)
- A user complaint about Stacks: "7 out of 10 times it chooses for deletion the pic I'd rather keep" (anecdotal) — via [TrustedReviews](https://www.trustedreviews.com/news/google-photos-new-ai-stacks-tool-takes-pity-on-instagram-spouses-4390967)
- **"Clean up this day" (Google Photos, Android)**: in development since fall 2025 and still in testing as of April 2026. It targets blurry photos, duplicates and failed selfies per day; not available to all users — [TalkAndroid](https://www.talkandroid.com/524408-clean-up-this-day-the-game-changing-google-photos-feature-making-storage-management-effortless/), [Android Authority](https://www.androidauthority.com/google-photos-library-mess-fixed-organized-how-3719874/)
- **Files by Google** has "Delete blurry photos" in its Clean tab — [jasondeegan.com](https://jasondeegan.com/running-out-of-google-photos-storage-heres-an-efficient-method-to-free-up-space/)
- Unverified single-blog claim: Android 17 on-device Gemini Nano cleanup that flags blur and near-duplicates (Pixel/AICore) — [SolidAITech](https://www.solidaitech.com/2026/05/android-17-hidden-ai-photo-cleanup-gemini-nano-guide.html)
- **Google Best Take**: composites the best expressions across group shots (Pixel) — referenced in [TheAppWhisperer 2026](https://theappwhisperer.com/2026/06/best-photo-culling-apps-2026/)
- **Samsung Gallery**: groups similar images and shows a "best" one; the others are hidden but not deleted (documented for One UI 5; no One UI 7 change found) — [SamMobile](https://sammobile.com/news/one-ui-feature-focus-ungroup-similar-photos-in-samsung-gallery)
- **Samsung Best Face (One UI 7)**: replaces faces in group shots using a burst; only for Motion Photo captures; S23/S24/Fold5+/Flip5+ — [SammyFans](https://www.sammyfans.com/2025/03/28/samsung-best-face-galaxy-s24-s23-one-ui-7/amp/), [Tom's Guide](https://www.tomsguide.com/phones/samsung-phones/how-to-use-best-face-photo-editing-feature-on-galaxy-s25)
- Apple Photos' built-in Duplicates album only finds (near) pixel-identical copies, not similar shots — [TheBusinessDive](https://thebusinessdive.com/?p=11442)

### Inferences
- Platform risk is **high** for "duplicates/blur/best of burst" as a standalone value proposition: Google is moving to exactly a per-day cleanup ("Clean up this day"). It is **moderate** for "learns my taste + daily top 3-5 + why": none of the natives personalize or explain, and Google tends to optimize for generic quality and storage.
- What is missing natively for a daily habit:
  - picks for the day across different scenes, not only within a stack
  - learning from keep/delete decisions
  - explanations
  - an evening ritual or notification
  - use-case modes (product photo for sellers, kid photo for parents, post-ready for creators)
  - export/share of the selected 3-5

### Gaps
- Official Google Photos release notes confirming "Clean up this day" general availability: not found.
- Samsung One UI 7/8 Gallery AI curation details from official release notes: not found.
- Apple Photos iOS 26 curation changes: not researched.

## 5. Market gap, threats, and verification of the earlier claims

### Takeaway
Gap: an Android-first, on-device app that (a) picks the day's best 3-5 photos across all scenes, (b) visibly learns from the user's own keep/skip decisions, (c) explains why, and (d) is priced honestly (no weekly trap). The nearest analogues (SpectraSort, Cullour) are iOS-only and tiny. The main threat is Google Photos absorbing per-day cleanup and best-pick into the OS/gallery for free.

### Cited Findings
- iOS-only taste-learning competitors: SpectraSort ($4.99/month, $29.99/year, $49.99 lifetime) and Cullour — [SpectraSort App Store](https://apps.apple.com/us/app/id6757512134), [Cullour App Store](https://apps.apple.com/cd/app/cullour/id6753363343)
- Cross-platform contender claiming taste learning: Topit (self-reported) — [mytopit.com](https://mytopit.com/ai-photo-selector)
- Android best-pick apps exist but are small or pro-focused (HotShot AI Photo Picker, PhotoPicker) — [HotShot Play](https://play.google.com/store/apps/details?id=com.hotshot.app&hl=en), [PhotoPicker Play](https://play.google.com/store/apps/details?id=app.photopicker&hl=en-US)
- Google is testing a per-day cleanup — [TalkAndroid](https://www.talkandroid.com/524408-clean-up-this-day-the-game-changing-google-photos-feature-making-storage-management-effortless/)

### Inferences
**Verdict on "In Google Play there is no real culling equivalent — only gallery cleaners with duplicates": MOSTLY TRUE, but overstated.**
- Large Android apps are indeed cleaners (Remo at about 3.1M installs, Slidebox, Swipewipe and many clones).
- However, small Android "AI photo picker" or culling apps do exist (HotShot AI Photo Picker updated Oct 2026, PhotoPicker for RAW, Topit claims Android).
- Google Photos Stacks plus the upcoming "Clean up this day" is itself a native culling equivalent for bursts.
- More accurate wording: "no scaled consumer app on Google Play does personal-taste culling."

**Verdict on "pro culling niche pays 10-15 USD/month, desktop only": LARGELY TRUE for the culling tiers.**
- Culling tiers run from FilterPixel $5-12.50 to Aftershoot Select about $10-15.
- Full suites cost $30-55/month.
- Small iOS (and one Android) mobile culling apps exist, so "desktop only" applies to the major brands.

**Pricing reference for a consumer app:**
- SpectraSort: $29.99/year or $49.99 lifetime.
- Gemini Photos: $19.99/year (US), 21.99 EUR/year (EU).
- Slidebox: $19.99/year.
- Clever Cleaner: free.
- This suggests that roughly 20-30 EUR/year (or RON-localized PPP pricing) with a lifetime option fits. A weekly sub would put the app in the distrusted "cleaner" bucket.

**Threats:**
- Google Photos per-day cleanup and best-pick.
- Samsung Gallery native grouping.
- Indie iOS apps porting to Android.
- Cleaner-app incumbents (MWM/Swipewipe has distribution) bolting on "AI best pick".

**Defensible angles:**
- Visible personal profile.
- Segment modes (sellers, parents, creators).
- A daily ritual with a notification.
- On-device privacy.
- A "why this photo" explanation.

### Gaps
- No market-size or revenue data (Sensor Tower/AppMagic not accessible).
- No user-research evidence that non-pros want daily (vs. occasional) curation. This is the core habit hypothesis and remains unvalidated.
