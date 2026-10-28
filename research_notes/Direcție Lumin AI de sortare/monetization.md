# Monetization: subscription benchmarks and best practices for a personal AI photo picker (Android, Romania/EU first)

> Method note: WebFetch could not reach the primary pages in this session (`support.google.com` and `www.revenuecat.com` did not resolve), so every figure below comes from search-result extracts of the cited pages. Treat exact percentages as "verify before quoting". FX assumption for the math: 1 EUR ≈ 5.0 RON. That is an approximation, not a sourced rate.

## 1. Benchmarks: install→trial, trial→paid, Photo & Video / Utilities, Android vs iOS, regional pricing

### Takeaway
Photo & Video is a weekly-plan-dominated, high-trial category. Adapty puts its weekly funnel at about 14% install→trial and about 30% trial→paid. Android converts downloads to paid at roughly a third of iOS's rate (0.9% vs 2.6% median by day 35), but trial→paid is about the same on both (around 32.5%). Revenue is extremely concentrated: Adapty reports that the top 10% of apps take about 95% of revenue. The "median" app numbers below therefore describe apps that already have traction, not a new niche app.

### Cited Findings
- RevenueCat Android analysis: trial→paid is 32.5% on Android vs 32.6% on iOS. Median download→paid by day 35 is 0.9% on Android vs 2.6% on iOS. Android surfaces fewer trials, but the users who do start one are higher-intent. — [RevenueCat: Android paywall gap](https://www.revenuecat.com/blog/engineering/android-paywall-gap)
- Adapty Photo & Video benchmarks (April 2026). Weekly-plan funnel: 14.0% install→trial, 30.5% trial→paid, 54.9% first renewal, 7.5% refund rate. — [Adapty: Photo & Video benchmarks](https://adapty.io/blog/photo-video-app-subscription-benchmarks/)
- Adapty Photo & Video: weekly plans produced 51% of category revenue in 2025 (49% in 2023). Annual share fell to about 8%. Trial usage fell from 70.7% to 62.3% in 2025, the steepest drop of any category. — [Adapty: Photo & Video benchmarks](https://adapty.io/blog/photo-video-app-subscription-benchmarks/)
- A secondary summary attributes a 49% Photo & Video trial→paid rate to Adapty. This conflicts with the 30.5% weekly-funnel figure above; it is likely a different plan type or aggregation. — search summary of [Adapty State of In-App Subscriptions 2026](https://adapty.io/state-of-in-app-subscriptions/)
- Adapty's global install→trial is published as 27.8% on one page and 10.9% on the summary page. The two use different definitions. — [Adapty SOIS 2026 report](https://adapty.io/state-of-in-app-subscriptions-report/); [The Social Outline: install-to-trial benchmarks](https://thesocialoutline.com/blog/install-to-trial-conversion-rate-benchmarks)
- Adapty 2026 dataset: more than 16,000 apps and more than $3B gross revenue in 2025. North America holds 55.6% of subscription revenue and Europe 21.3%. European prices rose 18% YoY. Each of the top 3 European countries beats the US on median LTV. — [Adapty SOIS 2026](https://adapty.io/state-of-in-app-subscriptions/); [PPC Land summary](https://ppc.land/95-of-app-subscription-revenue-goes-to-top-10-adaptys-2026-benchmark-report/)
- Top 10% of apps capture about 95% of subscription revenue (Adapty 2026). — [PPC Land](https://ppc.land/95-of-app-subscription-revenue-goes-to-top-10-adaptys-2026-benchmark-report/)
- RevenueCat 2026 report covers more than 115k apps, about $16B revenue and more than 1B transactions. Growth is concentrating at the top. — [SaaStr top-10 learnings](https://www.saastr.com/the-top-10-learnings-from-revenuecats-state-of-subscription-apps/); [Subscription Insider](https://www.subscriptioninsider.com/article-type/news/revenuecat-data-shows-subscription-app-growth-concentrating-at-the-top)
- Photo & Video apps lead in AI integration (about 61%) in RevenueCat 2026. AI apps earn about 41% more per user but churn about 30% faster. — [PPC Land: AI apps](https://ppc.land/ai-apps-earn-41-more-per-user-but-churn-30-faster-revenuecat-finds/); [Mobile Marketing Reads](https://www.mobilemarketingreads.com/?p=50360)
- Trial length (RevenueCat, 17k+ apps, correlational). Monthly plans convert 40% / 46% / 47% / 44% for trials of ≤4 / 5–9 / 10–16 / 17–32 days. Annual plans convert 24% / 33% / 43% / 45% for the same buckets. Weekly plans convert 22% at ≤4 days and 24% at 5–9 days. Monthly plans gain nothing beyond 10–16 days. — [RevenueCat: free trial length](https://www.revenuecat.com/blog/growth/free-trial-length); [SaaStr: 17,000 apps and trial length](https://saastr.com/what-17000-subscription-apps-tell-us-about-free-trial-length-annual-plans-convert-86-better-with-30-day-trials-monthly-tops-out-at-two-weeks-and-ai-apps-hit-a-wall-at-16-days)
- A headline figure in secondary summaries: 42.5% median trial→paid for 17–32 day trials vs 25.5% for ≤4 days. This is a different aggregation from the per-plan numbers above. AI apps reportedly "hit a wall" at about 16 days. — [SaaStr](https://saastr.com/what-17000-subscription-apps-tell-us-about-free-trial-length-annual-plans-convert-86-better-with-30-day-trials-monthly-tops-out-at-two-weeks-and-ai-apps-hit-a-wall-at-16-days); [PricePush trial benchmarks](https://pricepush.app/blog/trial-to-paid-conversion-rate-benchmarks)
- Android vs iOS (global, weakly sourced Adapty guide): average annual ARPU is $138 on iOS vs $72 on Android. D60 revenue per install is $0.38 vs $0.14. — search summary of [Adapty: mobile app monetization 2026](https://adapty.io/zh/blog/markdown/mobile-app-monetization-2026.md)
- Regional pricing (vendor blog, unverified): Romanian purchasing power is about 50–55% of the US. Annual plans discounted 40–50% vs monthly reportedly do better in Romania than in Western Europe. — [AppsOps: pricing in Eastern Europe 2026](https://appsops.store/blog/app-store-pricing-eastern-europe-2026)
- A vendor glossary puts mid-tier markets, Eastern Europe included, at about 60–80% of US pricing. — [PricePush: PPP glossary](https://pricepush.app/glossary/purchasing-power-parity)
- Default store FX conversion is not PPP pricing. RevenueCat has a post on fixing bad default global pricing. — [RevenueCat: 5 fixes for default global pricing](https://revenuecat.com/blog/growth/5-quick-fixes-for-bad-default-global-pricing-on-app-stores); [Adapty Pricing Index](https://adapty.io/app-subscription-pricing-index/)
- Romania's standard VAT rose from 19% to 21% on 1 Aug 2025. Digital B2C services are taxed at the customer's location. Apple raised Romanian App Store prices from 23 Aug 2025 because of the change. — [Avalara](https://www.avalara.com/blog/en/europe/2025/07/blog-romania-vat-rate-changes-2025.html); [Anrok](https://www.anrok.com/tax-news/romania-increases-standard-vat-rate-from-19-to-21); [Informat.ro](https://informat.ro/en/current-affairs/apple-to-raise-app-store-prices-due-to-vat-hike-76496)

### Inferences
- For an Android-only app, plan around a download→paid rate of roughly 0.5–1.5% under freemium. The 0.9% Android median is from apps that already have RevenueCat-scale traction.
- The Photo & Video "weekly dominates" pattern comes from paid-UA, AI-filter and editing apps. For a culling app with privacy positioning and organic, ASO-driven installs in Romania, annual and monthly plans are a better fit than weekly. Weekly has a 7.5% refund rate and fast churn, and it can look predatory to a trust-sensitive audience.
- Romania pricing should land around 50–65% of the US/Western-EU price, set manually in Play Console in RON rather than through auto-conversion. The listed price includes 21% VAT. Google handles EU VAT for Play sales; this is a common understanding but was not confirmed by a source here (see Gaps).

### Gaps
- No Utilities-category Android figure was found. No Photo & Video page from RevenueCat 2026 was indexed.
- No Romania- or CEE-specific conversion or LTV data was found in RevenueCat or Adapty public material. The regional tables appear to be gated.
- I could not confirm from a primary source how Google Play handles Romanian VAT (Google as deemed supplier / marketplace remitter).

## 2. Hard paywall at onboarding vs freemium (revenue per install, retention)

### Takeaway
Across all categories, hard paywalls beat freemium by roughly 5–9x on revenue per install. The data is observational: apps that choose hard paywalls are usually paid-UA, high-intent apps. Soft paywalls convert better per paywall view. Retention evens out over longer horizons.

### Cited Findings
- RevenueCat 2026: median download→paid within 35 days is 10.7% for hard-paywall apps vs 2.1% for freemium. Revenue per install at D60 is $3.09 vs $0.38, about 8x. — [RevenueCat: subscription app trends 2026](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026); [Airbridge](https://www.airbridge.io/en/blog/hard-paywall-vs-freemium-2026)
- RevenueCat 2026: D14 RPI is $2.32 for hard paywall vs $0.27 for freemium. — [Mobile Marketing Reads](https://www.mobilemarketingreads.com/?p=50360)
- RevenueCat 2025 data: hard paywalls convert at 12.1%. Year-1 LTV per payer is $49.30 for hard paywall vs $24.24 for freemium. — [Airbridge](https://www.airbridge.io/en/blog/hard-paywall-vs-freemium-2026)
- Adapty (secondary): soft paywalls convert about 50% better from paywall view to payment, while hard paywalls give about 21% higher 1-year LTV. The two metrics use different denominators. — [Adapty SOIS 2026](https://adapty.io/state-of-in-app-subscriptions/) via search summary
- Retention over longer periods tends to even out between the models. — [Airbridge](https://www.airbridge.io/en/blog/hard-paywall-vs-freemium-2026)
- The Product Hunt discussion notes that the 10.7% vs 2.1% comparison is observational, not randomized. — [Product Hunt: to hard paywall or not](https://www.producthunt.com/p/general/to-hard-paywall-or-not-that-is-the-question)

### Inferences
- A culling app needs to show value on the user's own gallery before asking for money. "It picked my best shots" is the moment of proof. A hard paywall before any scan risks uninstalls and 1-star reviews in a small market where ratings drive ASO.
- A workable hybrid: show the paywall during onboarding after the first scan result. Show a "here's what we found: 1,240 duplicates / 38 bursts" summary, then offer the trial, with a dismissible close. Keep a soft, usage-gated free tier for users who decline. This captures much of the hard-paywall uplift (offer shown to 100% of installs at peak intent) without blocking value.

### Gaps
- No category-specific (Photo & Video / Utilities) hard vs freemium split was found, and nothing Android-specific.

## 3. Value metric: per-photo vs per-burst/day limits vs feature gating

### Takeaway
I found no rigorous public study on how generous a free tier should be. Practitioner evidence favors metering a meaningful unit and placing the limit just after the first "win". Anecdotes show over-tight limits hurting conversion.

### Cited Findings
- A pricing case study: a team tightened a free limit and then restored the 10-unit limit after data showed the tighter restriction hurt conversion. — [search result: onepage-research pricing lesson](https://onepage-research.sliplane.app/lessons/pricing/price-p2)
- Practitioner report: "Adding friction worked way better than cutting features" (two apps, anecdotal). — [web2wave community](https://community.web2wave.com/t/our-free-tier-is-so-good-that-theres-not-much-reason-to-upgrade-we-definitely-messed-up-the-freemium-balance/1070)
- Guidance: put the paywall right after the user's first "win moment", identified from funnel drop-offs. — [Adapty: freemium to premium techniques](https://adapty.io/blog/freemium-to-premium-conversion-techniques)
- Competitor pattern: Clever Cleaner is marketed as free, but an AppFollow listing describes "generous daily limits". CleverFiles' terms mention a weekly subscription with trial and/or a lifetime purchase. — [AppFollow: Clever Cleaner](https://apps.appfollow.io/ios/clever-cleaner-photo-storage/1666645584?country=ca); [CleverFiles subscription notice](https://www.cleverfiles.com/help/?p=20163); [Cult of Mac](https://www.cultofmac.com/news/clever-cleaner-free-iphone-cleaner)

### Inferences
These are recommendations, not sourced findings.
- **Free:** scan plus AI scores and suggestions for the whole gallery, so users see the full value. "Today's pick" (Ziua de azi) stays free, along with manual keep/delete and a daily allowance of auto-applied decisions. Per-day limits ("clean 1 series / 50 photos per day free") are better than a lifetime cap. They create a return habit, and a lifetime cap feels like a trial that ran out.
- **Pro:** one-tap "apply all" or bulk delete across all bursts and duplicates, unlimited history and undo. Also Pro: the learning profile ("Teach me" pair tests that adapt the picks), the AI extras (Wrapped, then-and-now video export without watermark, AI captions and greetings, AI background), plus priority features. Server-side AI features have real per-use cost, so they should be Pro-only or credit-metered.
- Avoid gating on "number of photos analyzed". It hides the core value and feels small given galleries of 10k+ photos.

### Gaps
- No A/B data specific to photo-culling apps on per-photo vs per-day vs feature gating.

## 4. Comparable app prices (EUR/RON)

### Takeaway
Consumer photo cleaners cluster around $20–30/year, about $5/month, and $1–7/week, and many also offer a lifetime option. Most public price data is from iOS USD storefronts. Google Play and RON prices were not retrievable.

### Cited Findings
- Slidebox (US App Store): 1 week $1.99, 1 year $19.99, Premium Upgrade $19.99, plus a $4.99 item. An older listing showed yearly at $9.99, and one source cites $49.99, possibly lifetime. — [Slidebox App Store](https://apps.apple.com/us/app/-/id984305203); [SourceForge: Slidebox](https://www.sourceforge.net/software/product/Slidebox)
- Gemini Photos (MacPaw): $4.99/month, $19.99/year (US), S$29.98/year (Singapore). A one-time purchase is also offered. — search result on Gemini Photos listings
- Clever Cleaner: free (no ads) per developer and press. A third-party review lists $11.99/week and $49.99 lifetime; the sources conflict. — [Handy Recovery](https://www.handyrecovery.com/best-iphone-storage-cleaner-apps/); [Clever Cleaner App Store](https://apps.apple.com/us/app/-/id1666645584)
- Generic AI cleaners (iOS): weekly $0.99–$6.99, monthly $4.99, yearly $29.99–$49.99. — [Duplicate Photos Cleaner (SI)](https://apps.apple.com/si/app/duplicate-photos-cleaner-quick/id1597565553); [AI Cleaner](https://apps.apple.com/app/id995874162); [Hyper Cleaner IAP prices](https://apppricinglab.com/iap/apple/1514366072)

### Inferences
- Suggested launch price points (to be A/B tested):
  - **Romania:** 14.99 RON/month, 79.99–99.99 RON/year, and optionally 149–199 RON lifetime. Roughly €3/month and €16–20/year.
  - **Western EU:** €3.99–4.99/month and €19.99–29.99/year.
- Annual should be framed as roughly 50–60% off the monthly price.
- Trial: 7 days on annual. RevenueCat's data supports 10–16+ days for annual conversion, so test 7 vs 14. No trial, or a 3-day trial, on monthly.
- Skip weekly at launch.

### Gaps
- Remo, Cleanup and Clever Cleaner prices on Google Play, and any RON storefront prices, were not found.

## 5. Google Play Billing compliance, fees, Data safety

### Takeaway
Digital subscriptions sold in-app must use Play Billing. EEA developers have alternative routes (user choice billing, external offers), but a solo developer gains little from them. The subscription fee is effectively 15% today and stays 15% (10% service + 5% billing) under the new structure for EEA/UK/US transactions from 30 Jun 2026. On Data safety, purely on-device processing is not "collected". Anything sent to a server (for example, cloud AI features) must be declared.

### Cited Findings
- New Google fee structure: auto-renewing subscriptions pay a 10% service fee plus a 5% billing fee for EEA, UK and US transactions from 30 June 2026. The 5% billing fee does not apply to alternative billing or external links. Australia moves by 30 Sep 2026 and the rest of the world by 30 Sep 2027. — [Google Play Console Help: service fees](https://support.google.com/googleplay/android-developer/answer/112622?hl=en); [Adapty: Play billing changes](https://adapty.io/blog/google-play-billing-changes-subscriptions-fees); [PricePush: fees 2026 math](https://pricepush.app/blog/google-play-subscription-fees-2026-real-math)
- Subscriptions have been at 15% since 2022. Some reports describe a 20% web-link option or 10–25% tiers depending on new vs existing installs and program participation; the sources conflict. — [iClarified](https://www.iclarified.com/83054/google-decreases-play-store-subscription-fee-to-15); [Google Play help](https://support.google.com/googleplay/android-developer/answer/112622?hl=en-CA)
- EEA external offers program (DMA): launched March 2024 with 5% initial / 7% ongoing fees for subscriptions. Revised 19 Aug 2025, with a Tier 1 rate of about 10%. Enrolled apps cannot also use Play Billing or user choice billing. — [9to5Google](https://9to5google.com/2024/03/06/google-play-external-offers/); [Developer-Tech](https://www.developer-tech.com/news/google-alters-play-store-developer-fees-rules-in-the-eea/); [Google help: external offers](https://support.google.com/googleplay/android-developer/answer/16505463?hl=en)
- Data safety: data accessed only on the device and not sent off it does not need to be disclosed as "collected". Ephemeral off-device processing (in memory only, kept no longer than the real-time request) must still be declared in the form but is not shown publicly. Data used to build user profiles cannot count as ephemeral. — [Google Play Help: Data safety](https://support.google.com/googleplay/answer/11416267?hl=en); [DEV: Data safety 2026](https://dev.to/toty_cartooncartoon_c254/google-play-data-safety-form-2026-answers-that-wont-get-your-app-rejected-4bh8)

### Inferences
- Use Play Billing only. The EEA alternatives save at most a few points and add tax, refund and compliance work.
- A "No data collected" label is achievable only if every feature runs on-device and no analytics or crash SDK sends identifiers. The project's server-side AI features (FLUX background on Cloudflare, AI titles, captions and greetings) send photos or text off-device. They must be declared: at minimum as ephemeral processing, and "collected" if anything is stored or logged. An honest split is better: "core sorting 100% on-device; optional AI extras send the selected photo to our server".
- RevenueCat or Adapty SDKs and Firebase/Sentry each add declarable data (purchase history, device IDs, crash logs).

### Gaps
- I could not open Google's fee page to confirm the exact current table (15% vs 20% variants) or the date the page was published.

## 6. Revenue math: subscribers needed for €300/month net

### Takeaway
At realistic EU/RO prices, €300/month net needs about 90–260 active payers, depending on plan mix. At Android freemium conversion rates that implies roughly 10k–30k+ installs, or about 2.5–5k installs if a near-hard paywall reaches benchmark rates.

### Cited Findings
- Fee basis: 15% on subscriptions — [Google Play help](https://support.google.com/googleplay/android-developer/answer/112622?hl=en). Romania VAT 21% — [Avalara](https://www.avalara.com/blog/en/europe/2025/07/blog-romania-vat-rate-changes-2025.html). Android D35 download→paid median 0.9% — [RevenueCat](https://www.revenuecat.com/blog/engineering/android-paywall-gap). Hard paywall 10.7% vs freemium 2.1% — [RevenueCat](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026).

### Inferences
Calculations assume 21% VAT inside the consumer price, then a 15% Play fee on the ex-VAT amount. Income tax is ignored, and FX is 1 EUR ≈ 5.0 RON.

| Plan (consumer price) | Net to dev / period | Net / month | Payers for €300/mo |
|---|---|---|---|
| Monthly €2.99 (~14.99 RON) | €2.10 | €2.10 | ~143 |
| Monthly €4.99 | €3.51 | €3.51 | ~86 |
| Annual €19.99 (~99.99 RON) | €14.04 | €1.17 | ~256 |
| Annual €29.99 | €21.07 | €1.76 | ~171 |
| Annual 79.99 RON (~€16) | ~€11.24 | €0.94 | ~320 |
| Weekly €1.99 | €1.40 | ~€6.05 | ~50 (high churn and refunds) |
| Lifetime €39.99 (one-time) | €28.09 | – | ~11 sales/month |

- With a 60/40 annual €19.99 / monthly €3.99 mix (monthly €3.99 nets about €2.80), the blended net is about €1.82 per payer per month, so about 165 active payers.
- Installs: at 0.9% download→paid, 165–256 payers need about 18k–28k cumulative installs, ignoring churn. At 2–3% (good onboarding paywall placement) the figure is about 6k–13k. At hard-paywall rates around 10%, about 2k–3k. Annual-plan churn (only about 27–28% retained at year one, per secondary sources) means the base must be refilled continuously.
- For a Romania-first niche app, €300/month is a meaningful but non-trivial target. It most likely needs EU-wide (EN plus other locales) distribution, not Romania alone.

### Gaps
- No Romania-specific install volume benchmarks were found for photo-utility apps on Play.
- The year-1 annual retention figure (27–28%) was not verified against a primary source.
