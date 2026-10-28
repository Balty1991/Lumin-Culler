# Onboarding / cold start: how a photo-sorting app should learn a new user's taste

Research date: 2026-10-28. Method: web search only. Direct page fetches were blocked in this session (huggingface.co, support.google.com, pexels.com, ojs.aaai.org and re.public.polimi.it did not resolve), so most license and policy points come from search-result summaries of the official pages plus secondary sources. These are marked where relevant. Anything legal should be checked against the primary texts before shipping.

Context: Lumin already has a pairwise "Învață-mă" taste test on the user's own gallery (task #24), FLUX on Cloudflare for backgrounds (task #17), and a visible AI profile. The question is whether to add, or replace with, a fixed curated sample set.

## 1. Cold-start preference elicitation: seed items, active learning, how many judgments

### Takeaway
The literature treats onboarding length as a direct trade-off between accuracy and user effort. Industry practice in recommenders has been about 10 initial ratings, and research asks how far below 10 you can go. Pairwise ("relative") questions are proposed specifically because absolute ratings suffer from calibration problems. Active selection of informative items or pairs (Bayesian or Bradley-Terry information gain) is well established. There is no universal "N judgments" number. For a photo culler the realistic target is about 15–30 quick pairwise or keep/reject judgments at onboarding, and learning continues passively afterwards.

### Cited Findings
- Cremonesi, Garzotto et al. frame cold start as "profile length," the number of ratings a new user must give before getting recommendations. More ratings raise accuracy but add burden. They used offline simulation plus an online study with 960 users and 4 algorithms to find an "optimal" profile length for rating-based elicitation. I could not read the exact optimum (PDF unreachable). — [Cremonesi et al., Politecnico di Milano](https://re.public.polimi.it/bitstream/11311/692316/3/p27-cremonesi.pdf); [User effort vs. accuracy in rating-based elicitation](https://www.scilit.net/publications/acccf5923a76005b63480f919e7b81a1)
- An MDPI paper (2020) notes that each site it examined requires at least ten ratings from new users. It studies whether fewer ratings can still give reliable predictions (the "magic number"). — [MDPI Mathematics 8(12):2138](https://www.mdpi.com/2227-7390/8/12/2138)
- University of Minnesota course slides give a rule of thumb: with fewer than 4 ratings, fall back to a baseline (non-personalized) model. These are slides, not a peer-reviewed result. — [UMN slides](https://www-users.cse.umn.edu/~kluve018/static/EvaluatingRecommenderBehavior.pdf)
- Sepliarskaia et al. (RecSys 2018) propose relative (pairwise) preference questions for cold-start elicitation instead of absolute ratings, because absolute ratings suffer from a calibration issue. — [Sepliarskaia et al. 2018](https://irlab.science.uva.nl/wp-content/papercite-data/pdf/sepliarskaia-preference-2018.pdf)
- A 2024 arXiv paper proposes a two-phase scheme: users first rate a small set of popular items in a "burn-in" phase, then personalized elicitation follows. — [arXiv 2406.00973](https://arxiv.org/abs/2406.00973)
- ICML 2023 work on music onboarding uses an artist picker where the list is chosen dynamically from earlier selections and skips, and users can stop anytime ("Done"). This is adaptive elicitation in a real onboarding UI. — [ICML 2023, Preference Elicitation for Music Recommendations](https://icml.cc/virtual/2023/29091)
- Active pairwise selection: Hybrid-MST uses Bradley-Terry scaling and picks pairs that maximise expected information gain (Lindley's Bayesian framework). IJCAI 2018 frames choosing comparisons as batch active learning with submodular objectives. — [IJCAI 2018](https://www.ijcai.org/proceedings/2018/0304.pdf); [arXiv 1810.08851](https://arxiv.org/pdf/1810.08851v1.pdf)
- SCoRa (ICML 2026) reports that, for a fixed elicitation budget, mixing ratings and comparisons can beat either alone, especially when ranking the top items correctly matters most and active learning prioritizes their comparisons. — [arXiv 2602.08033](https://www.arxiv.org/pdf/2602.08033)
- Claims that pairwise judgments are much more self-consistent than 0–10 scores (for example "90%+ within-rater agreement" and scores clustering at 6–8) come only from blogs and vendors. No controlled sample-complexity comparison was found. — [qaskills blog 2026](https://qaskills.sh/blog/pairwise-llm-evaluation-guide-2026); [zeroentropy](https://zeroentropy.dev/concepts/pairwise-preference/)
- Professional culling/editing tools need far more data for a fully personal profile. Aftershoot asks for at least 2,500 images and recommends 5,000+. Imagen says 2,000–3,000 edited photos, its own support pages conflict on the figure, and it offers a "Lite" profile from a preset with no photos. — [Aftershoot support](https://support.aftershoot.com/en/articles/6673009-how-many-images-should-i-use-to-train-a-profile); [Imagen support](https://support.imagen-ai.com/hc/en-us/articles/6401097189905-How-many-photos-are-needed-to-build-a-profile); [Imagen Lite profile](https://support.imagen-ai.com/hc/en-us/articles/12571289908893)

### Inferences
- A deep personal model is not learnable from about 20 judgments. What 20 judgments can do is re-weight a small number of interpretable factors on top of a strong generic model: sharpness tolerance, faces and eyes, "people over scenery," exposure tolerance, duplicate strictness, and favoring certain people or pets. Treat onboarding as fitting about 5–10 weights, not training a model. This matches the "Lite profile" idea and the "fewer than about 4 ratings means baseline" rule.
- Suggested budget: a minimum of about 10 judgments before showing any "personalized" claim, a target of 20–30 at onboarding (about 1–2 minutes), and then passive learning from every real keep/delete decision. Allow "Done" early, as in the ICML music picker.
- Use active pair selection. Pick pairs where the current model is most uncertain, or where the two photos differ mainly on one factor such as blur versus a face with closed eyes. That makes each answer informative about one weight.

### Gaps
- The exact optimal profile length from Cremonesi et al. (PDF not reachable).
- No controlled study of the number of pairwise versus absolute judgments needed for equal accuracy in image aesthetics.

## 2. Do judgments on generic, stock or AI-generated photos transfer to the user's own photos?

### Takeaway
The evidence suggests transfer is weak for subjective taste. When people choose among their own photos, image quality ranks lowest among selection criteria, and personal attachment and event coverage dominate. Familiar faces are also judged differently from strangers' faces. Few-shot personalized aesthetics models show only modest or even non-significant gains over generic predictions. A sample set of strangers' or AI photos can teach objective quality tolerance, but it cannot capture "I keep the blurry photo because it's my kid laughing."

### Cited Findings
- Ceroni et al. (L3S, ICMR and ICME workshop 2015) had 42 users select important photos from their own event collections: 91 collections, 18,147 photos, about 20% selected. Image quality was rated the least important criterion. Personal and "hidden" aspects such as memories and attachment, and event coverage, were rated highly important. Note: from slides and abstracts, not the full paper. — [Ceroni slides (PhotoPrism mirror)](https://dl.photoprism.app/pdf/publications/20180201-Ceroni_Personal_Photo_Management_and_Preservation.pdf); [ICME 2015 record](https://katalog.lib.cas.cz/KNAV/EdsRecord/edsair,edsair.doi...........f4b4722911765f05a47e35c6034b60a3)
- Follow-up work notes that photo selection, especially for personal data, "can be highly subjective" and its drivers vary by individual, which motivated personalized models. — [Ceroni slides](https://dl.photoprism.app/assets/slides/Personal%20Photo%20Management%20and%20Preservation.pdf)
- Familiarity changes judgment. White et al. (2017) found people choose photos of themselves that make worse first impressions than photos strangers choose. Self-chosen photos also matched identity about 7% less accurately (2015). The authors suggest familiarity with any face, not only one's own, makes it harder to tell images of that face apart. — [White et al., Cognitive Research 2017](https://cognitiveresearchjournal.springeropen.com/articles/10.1186/s41235-017-0058-3); [UNSW news 2015](https://www.unsw.edu.au/news/2015/07/study-we-dont-look-we-think-we-look)
- The self-face is remembered as more attractive than it is: participants picked edited versions of their own face, with larger eyes and a smaller mouth, more often than for classmates. — [PubMed 25469224](https://pubmed.ncbi.nlm.nih.gov/25469224/)
- Goree, Khoo and Crandall (AAAI 2023), "Correct for Whom?": few-shot personalized PIAA predictions did not significantly improve average accuracy over raw (generic) predictions. They caution against relying on benchmark datasets to evaluate personalization. — [AAAI 2023](https://ojs.aaai.org/index.php/AAAI/article/view/26395); [mlanthology](https://mlanthology.org/aaai/2023/goree2023aaai-correct)
- Recent PIAA work uses 10-shot and 100-shot protocols per user. Yun and Choo (KAIST, 2024, task-vector customization) report beating previous methods at 10-shot on AADB and REAL-CUR. PRAC (arXiv 2026) uses a multimodal LLM with preference-rich sample mining. — [arXiv 2407.07176](https://arxiv.org/abs/2407.07176v2); [arXiv 2607.15752](https://arxiv.org/pdf/2607.15752)
- Domain shift with AI images: AI-generated image quality benchmarks show large distribution gaps even between AI datasets of different eras. D-Judge finds "substantial discrepancies" between AI-generated and natural images on several dimensions, including aesthetics. AIGC quality scores also mix in prompt alignment, which real photos lack. — [D-Judge arXiv 2412.17632](https://arxiv.org/pdf/2412.17632v3); [IP-IQA arXiv 2403.18714](https://web3.arxiv.org/pdf/2403.18714); [ACL-IQA arXiv 2608.24372](https://arxiv.org/pdf/2608.24372)

### Inferences
- Judgments on curated or AI samples about strangers will mostly measure generic aesthetics, which a pretrained aesthetic or quality model already has. They add little personal signal. On personal photos, attachment overrides quality, so a stranger-photo test may even mis-calibrate how strict the culler should be (for example, a user rejects blurry stranger photos but keeps blurry family photos).
- AI-generated samples have an extra risk: they look "too clean" and differ statistically from phone photos, so tolerance learned on them may not transfer.
- The 10-shot PIAA results come from benchmark users rating generic images, not owners rating their own family photos. Do not assume similar gains carry over.

### Gaps
- No study found that directly tests the transfer of preferences from AI-generated or stock samples to the same users' own photo libraries.

## 3. UX evidence for swipe or picker taste onboarding: completion, length, drop-off

### Takeaway
Hard, independent numbers for taste pickers are scarce. General onboarding data says completion falls as steps increase, and the best-known taste-swipe product (Stitch Fix Style Shuffle) presents swiping as an ongoing game, not a one-time gate. The design implication is a short skippable gate (about 1 minute), with learning continuing as an optional, game-like loop.

### Cited Findings
- Stitch Fix Style Shuffle (thumbs up/down, launched March 2018) passed 10 billion interactions by Aug 2022, about 4.5M per day. Each swipe updates the "Latent Style" model in real time. Swipes complement the initial style quiz. Clients who play report higher satisfaction, but this is a company-reported correlation. — [Stitch Fix newsroom 2022](https://newsroom.stitchfix.com/blog/10-billion-interactions-and-counting-on-style-shuffle-the-data-powering-your-personalized-shopping-experience/); [Quartz](https://qz.com/quartzy/1603872/how-stitch-fixs-style-shuffle-learns-your-style); [Stitch Fix support](https://support.stitchfix.com/support/solutions/articles/153000173925)
- Spotify's taste onboarding asks for a few artists, then says recommendations "get better with more listening." Elicitation is a seed, and behaviour does the refinement. — [Spotify newsroom tag](https://newsroom.spotify.com/tag/taste-onboarding/); [uxcel teardown](https://app.uxcel.com/showcase/spotifys-new-user-onboarding-feature-product-teardown-222)
- Directional (unsourced vendor table): 1–2 onboarding steps give about 70–85% completion, 3–4 steps about 55–70%, and 5–7 steps about 35–55%. One fintech cut from 5 to 3 screens and drop-off fell from 68% to 43%. — [thisisglance](https://thisisglance.com/learning-centre/how-can-i-check-if-my-onboarding-flow-is-too-long)
- Completion targets conflict: Adapty says 90–95%, while another source cites UXCam 2024 at 60–80%. A 464-product SaaS dataset puts median tour completion around 29%. — [Adapty](https://adapty.io/blog/markdown/mobile-app-onboarding-vs-tutorials.md); [getmonetizely](https://www.getmonetizely.com/articles/understanding-onboarding-completion-rate-a-critical-metric-for-saas-success); [IndieHackers](https://www.indiehackers.com/post/onboarding-benchmarks-from-real-data-across-464-saas-products-median-tour-completion-is-29-6288651c93)
- Recommended practice: instrument drop-off per screen and time-to-first-"aha" rather than only overall completion. — [PostHog](https://posthog.com/blog/how-to-find-and-fix-app-onboarding-drop-off.md)

### Inferences
- Treat the 20–30 judgments as one "screen" with a progress bar and a visible payoff, for example "AI already agrees with you 14/20," and allow skipping after about 10.
- Make the first useful action, a cleanup suggestion on their own gallery, reachable within about 60 seconds.
- Continue elicitation inside the real sorting flow: every keep/delete is a label, and an optional "Învață-mă" round can be offered as a daily mini-game, as Style Shuffle does.
- Pairwise "which one would you keep?" fits culling naturally because users choose between burst or near-duplicate shots anyway. Swipe keep/reject is faster per item but less informative per tap. A mix suits the task (see SCoRa above).

### Gaps
- No public completion or drop-off data specific to taste pickers (Spotify, Netflix, Pinterest) or to photo-app taste tests was found. Netflix onboarding details were not found.

## 4. Fixed sample set for objective defects, own photos for subjective taste: hybrid flows

### Takeaway
This split is well supported by inference from the sources above. Objective defects (blur, closed eyes, over- or under-exposure, near-duplicates, tilted horizon) are things generic models already detect. A curated set mainly calibrates how strict the user wants the culler to be and demonstrates what the AI can see. Personal taste (which people matter, attachment, "moment over quality") can only come from the user's own photos.

### Cited Findings
- Quality is the least important criterion when people choose their own photos, and personal attachment dominates. — [Ceroni slides](https://dl.photoprism.app/pdf/publications/20180201-Ceroni_Personal_Photo_Management_and_Preservation.pdf)
- Professional tools offer a no-data starting profile (Imagen "Lite" from a preset) before personal data accumulates. — [Imagen Lite](https://support.imagen-ai.com/hc/en-us/articles/12571289908893)
- Two-phase elicitation (a burn-in on a fixed set, then personalized) appears in recommender research. — [arXiv 2406.00973](https://arxiv.org/abs/2406.00973)

### Inferences (proposed flow)
1. **Step 0 (0 judgments):** generic model plus 2–3 slider or chip choices: "How strict? Gentle / Balanced / Ruthless" and "What matters most: people / places / everything." This is the "Lite profile."
2. **Step A, optional, about 6–8 judgments on a fixed calibration set:** synthetic or licensed pairs that each isolate one defect (sharp vs. slightly blurred, eyes open vs. closed, well vs. badly exposed, two near-identical shots). Purpose: set defect-tolerance thresholds and show the user what the AI detects. Prefer non-human subjects or obviously stylised people to avoid legal and ethical issues (see §5). A fixed set also gives a cross-user comparable baseline for analytics.
3. **Step B, core, about 15–20 actively chosen pairs from the user's own gallery:** bursts and near-duplicates where the model is uncertain, and pairs that contrast people, pets or kids against scenery. All of this stays on device.
4. **Step C, continuous:** every real keep/delete updates weights. Show "agreement %" over time.
- Own photos should be the primary signal. The fixed set is a short optional calibration and demo, not the main teacher. If photo permission is denied, fall back to Step A only and say that personalization is limited.

### Gaps
- No empirical A/B evidence for this exact flow was found. It should be validated with Lumin's own telemetry (agreement after N judgments, with and without Step A).

## 5. Licensing and legal: shipping AI-generated or stock sample images in a commercial app

### Takeaway
- **FLUX.1 [schnell] (Apache-2.0):** the cleanest option for commercially shipped sample images.
- **FLUX.1 [dev]:** its outputs clause says it claims no ownership and outputs "may be used for any purpose," but the model itself is non-commercial, so generating assets for a commercial product is disputed. Avoid it unless you buy BFL's commercial license.
- **SDXL (OpenRAIL++-M):** allows output use subject to Attachment A use restrictions.
- **SD 3.5 (Stability Community License):** free commercial use only under $1M in annual revenue.
- **Cloudflare Workers AI:** passes model license terms through to you.
- **Disclosure:** EU AI Act Art. 50 deployer duties for deepfakes have applied since 2 Aug 2026. Photoreal AI images of "people" presented as photos may need a clear AI label. Google Play's AI-Generated Content policy targets apps that generate content and requires flagging and reporting. Pre-baked images are likely outside its core scope, but child-safety rules apply regardless.
- **Unsplash and Pexels:** bundling a few photos is generally fine, but you need model releases for identifiable people and must not redistribute them as a stock or wallpaper library.

### Cited Findings
- FLUX.1 [schnell]: "released under the apache-2.0 licence, the model can be used for personal, scientific, and commercial purposes" (model card text, seen via mirrors). Apache-2.0 covers the weights. Output ownership is not addressed by Apache itself. — [HF model card mirror](https://huggingface.co/Niansuh/FLUX.1-schnell); [BFL README mirror](https://huggingface.co/black-forest-labs/FLUX.1-schnell/raw/refs%2Fpr%2F100/README.md)
- Conflicting third-party listings: one calls the schnell license "permissive for non-commercial personal use." This contradicts the official card, which says Apache-2.0, and is likely an error. — [llmreference](https://www.llmreference.com/model/flux-1-schnell)
- FLUX.1 [dev] Non-Commercial License: "Outputs" are not Derivatives. BFL claims no ownership, and you may use Outputs for any purpose, except training a competing model. But "Non-Commercial Purpose" excludes revenue-generating activity, and the community disputes whether generating commercial assets is permitted. BFL sells a self-serve commercial dev license that explicitly allows commercial use of the model and outputs. — [License text (Wind River copy)](https://open.windriver.com/info/uni-license-list/licenses/flux-1-nc.html); [BFL help: self-serve dev license](https://help.bfl.ai/articles/9272590838-self-serve-dev-license-overview-pricing); [HF discussion](https://huggingface.co/black-forest-labs/FLUX.1-dev/discussions/7)
- Cloudflare Workers AI: Cloudflare does not create or train the models. Models "may be subject to open source or other license terms that apply between you and the model provider," and you should review each model's license. Customer content is not used for training without consent. — [Cloudflare Workers AI privacy/terms](https://developers.cloudflare.com/workers-ai/platform/privacy/)
- SDXL, CreativeML OpenRAIL++-M: the licensor claims no rights in Output, but "You are accountable for the Output you generate." Use-based restrictions in Attachment A apply and must flow down to derivatives. The license covers use "in an end-use application." Some forks differ, for example by requiring CC0 outputs, so check that the license file belongs to the official SDXL repo. — [OpenRAIL++-M text](https://open.windriver.com/info/uni-license-list/licenses/bigscience-open-rail-m2.html); [SDXL license copy](https://huggingface.co/raovasudev762/SpecialSDXL/blob/main/model_licenses/LICENSE-SDXL1.0)
- Stability AI Community License (SD3 / SD3.5): covers commercial use for organizations with under $1M annual revenue. Above that, an Enterprise license is needed. Secondary sources say users own their outputs. — [Stability AI licensing page](https://stability.ai/membership); [terms.law summary](https://terms.law/ai-output-rights/stable-diffusion/); [Decrypt 2024](https://decrypt.co/238871/stable-diffusion-3-license-revamped-amid-blowback)
- Google Play AI-Generated Content policy:
  - **Scope:** apps that generate AI content from text, voice or image prompts. Apps that only host AI content are out of scope, and so are productivity apps that use AI to improve an existing feature.
  - **Prohibited:** generating offensive content, including content that exploits or abuses children.
  - **Required:** in-app reporting or flagging of offensive AI output (since early 2024).
  - (Summarized from search results. The page itself could not be fetched.) — [Google Play Console Help 14094294](https://support.google.com/googleplay/android-developer/answer/14094294); [TechCrunch 2023](https://techcrunch.com/?p=2619733); [9to5Google](https://9to5google.com/2023/10/25/google-play-gen-ai-policy/)
- EU AI Act Art. 50:
  - **Timing:** deployer obligations to disclose deepfakes (AI-generated or manipulated image, audio or video that resembles real people, objects or places and could falsely appear authentic) apply from 2 Aug 2026.
  - **Form:** disclosure must be clear and perceivable, and machine-readable marks alone are not enough. Lighter rules apply to evidently artistic or fictional works.
  - **Provider marking:** sources conflict on whether the machine-readable marking duty for already-marketed generative systems was deferred to 2 Dec 2026.
  - **Fines:** up to €15M or 3% of turnover.
  - (Secondary sources only.) — [artificialintelligenceact.eu guide](https://artificialintelligenceact.eu/transparency-rules-article-50/); [Lewis Silkin, Jul 2026](https://www.lewissilkin.com/insights/2026/07/31/the-new-ai-labelling-rules-for-deployers-in-the-advertising-supply-chain); [CSA research note, Jul 2026](https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/07/CSA_research_note_eu_ai_act_article_50_transparency_20260729-csa-styled-1.pdf); [McCann FitzGerald](https://www.mccannfitzgerald.com/knowledge/data-privacy-and-cyber-risk/ai-transparency-european-commissions-guidelines-on-article-50-part-2-deployer-obligations)
- Unsplash License: free use, but it "does not include the right to compile photos from Unsplash to replicate a similar or competing service." Unsplash's co-founder says individual photos are unrestricted and the limit applies only to collections intended to build a similar service. The same bar applies under Unsplash+. — [Unsplash help](https://help.unsplash.com/en/articles/2612331-why-can-t-i-compile-photos-from-unsplash-to-replicate-a-similar-or-competing-service); [WP Tavern](https://wptavern.com/unsplash-updates-its-license-raises-gpl-compatibility-concerns); [Unsplash+ license](https://unsplash.com/plus/license)
- Pexels:
  - **Identifiable people:** must not be shown in a bad light or offensively (for example in criminal activity, with a medical ailment, or in a pornographic context).
  - **Redistribution:** do not redistribute or sell the photos on other stock or wallpaper platforms, and do not sell unaltered copies.
  - **Trademarks:** no use as a trademark or business name.
  - **Clearance:** the license does not clear identifiable people, logos or brands that appear in images.
  - (Official help page, via search.) — [Pexels help: rules](https://help.pexels.com/hc/en-us/articles/360042332714-What-are-the-rules-for-using-Pexels-photos-or-videos); [Pexels ToS](https://pexels.com/terms-of-service)

### Inferences
- **Safest path for a fixed sample set:** generate with FLUX.1 [schnell] (Apache-2.0, including via Cloudflare Workers AI, where model terms pass through). Store prompts, seeds, model ID and date as provenance.
- **Avoid photorealistic children entirely.** Prefer pets, objects, landscapes and food, or non-photoreal or obviously staged adult "people" for the closed-eyes and blur examples. Reasons: no model release exists, child-safety policy risk is high, and photoreal humans trigger Art. 50 "deepfake" disclosure questions.
- **Label the set** with a short note such as "Sample images generated with AI." It is cheap, may be legally required in the EU, and is honest, because users are told the AI "learns from them."
- **Google Play policy:** pre-generated, bundled images arguably fall outside the AI-Generated Content policy's core scope, since the app is not generating from user prompts. Lumin already ships generative features (FLUX backgrounds, AI captions), though, so it already needs the reporting/flagging mechanism for those.
- **Stock alternative:** Unsplash or Pexels photos are acceptable for a few bundled images, but you need model releases for identifiable people (Unsplash and Pexels don't guarantee them). Do not let users download or export the set as a gallery. AI-generated non-human subjects avoid the release problem.
- **Avoid in shipped commercial assets:** FLUX.1 [dev] without the paid license, and SD3.5 if revenue may exceed $1M.

### Gaps
- Primary license texts and the Google Play policy page could not be fetched in this session. Verify the exact wording.
- Copyrightability of AI outputs (relevant only to whether others can copy the sample set) was not researched.
- Cloudflare's own Service-Specific Terms for Workers AI were not retrieved verbatim.

## 6. Metrics: showing a trustworthy "AI picks like me" agreement % quickly

### Takeaway
No published standard was found. Statistical reasoning suggests agreement on fewer than about 20 judgments is very noisy. Show it as "X of N" with an honest range, compute it on held-out judgments the model did not train on, and compare it against a baseline (generic model or chance) so the number means something.

### Cited Findings
- Goree et al. warn that personalized aesthetics evaluation is fragile: few-shot gains often aren't significant, and benchmark-based evaluation can mislead. — [AAAI 2023](https://ojs.aaai.org/index.php/AAAI/article/view/26395)
- The comparative-judgement literature warns that a common reliability metric (scale separation reliability) can be biased and hard to interpret, and proposes agreement-based metrics. — [arXiv 2503.00479](https://arxiv.org/html/2503.00479v3)
- Practitioners recommend tracking per-step behaviour and outcomes, not just completion. — [PostHog](https://posthog.com/blog/how-to-find-and-fix-app-onboarding-drop-off.md)

### Inferences
- **Holdout measurement:** Predict before reveal. For each onboarding pair after the first about 5, the model makes its prediction before the user answers. Agreement = predicted == chosen. This is a natural holdout and makes a satisfying live counter ("AI guessed 9/12").
- **Noise at small n** (binomial standard error ≈ sqrt(p(1−p)/n)):
  - At n=10 and p=0.8, the 95% interval is about ±25 percentage points.
  - At n=20, about ±18pp.
  - At n=50, about ±11pp.
  - So show "8/10" rather than "80%" until n is at least 20–30, or show a confidence band.
- **Uplift over baseline:** report "Generic AI: 64% → Your AI: 78%" on the same pairs. Pairwise chance is 50%, and generic models already agree on easy defect pairs, so an absolute % alone overstates personalization.
- **Ongoing metric:** the acceptance rate of AI suggestions in real sorting (share of AI "delete" picks the user confirms, and share of AI "keep" picks the user overrides). Show this weekly on the AI Profile.
- **Exclude trivial pairs:** separate "objective" pairs (very blurred vs. sharp) from "taste" pairs so trivial agreement doesn't inflate the score.

### Gaps
- No industry examples were found of consumer apps that display a personalization agreement % and how users react to it.
