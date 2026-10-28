# On-device personal photo-preference model (Android): technical approaches

Research constraints worth knowing: in this session WebFetch could not reach arxiv.org, huggingface.co or research.google (DNS blocked). All findings below come from search-result snippets and summaries of primary pages (papers, model cards, Android docs), not full-text reads. Specific numbers should be checked against the original PDF/model card before they go into public copy.

**Local codebase context (verified by reading the repo):** the app already ships an on-device CLIP image encoder. It is the OpenAI CLIP ViT-B/32 vision tower (MIT), exported to quantized ONNX as `clip_vision_q.onnx`, run through ONNX Runtime, with 512-dim embeddings for 224x224 center crops. Embeddings are persisted per photo in `clip_index.bin` as float16. See `/home/user/Lumin-Culler/android/app/src/main/java/com/luminculler/app/cleaner/search/ClipIndex.kt` (constants `MODEL`, `DIM = 512`) and `/home/user/Lumin-Culler/tools/build_clip_vocab.py` (which states the source is `Xenova/clip-vit-base-patch32`). The personal model can be trained on these existing embeddings at almost no extra inference cost.

---

## 1. PIAA state of the art (2022-2026) and gains from 10/100 user labels

### Takeaway
Academic personalized image aesthetics assessment (PIAA) is benchmarked on FLICKR-AES and PARA with 10-shot and 100-shot per-user protocols, and reports Spearman rank correlation (SROCC). SOTA sits around 0.69-0.78 on FLICKR-AES and around 0.70-0.73 on PARA. Going from 10 to 100 labels adds only about +0.02 to +0.09 SROCC. Most of the quality comes from a strong generic prior, and the per-user part is a small adjustment. That supports "generic score + small per-user head on frozen embeddings".

### Cited Findings
- Standard PIAA protocol: methods are evaluated with 10-shot and 100-shot support sets per test user, reporting average SROCC across held-out users. FLICKR-AES uses 37 test users and PARA uses 40 — [PRAC, arXiv 2607.15752](https://arxiv.org/pdf/2607.15752); [Yun & Choo, ECCV 2024, arXiv 2407.07176](https://arxiv.org/pdf/2407.07176)
- PARA: about 31k images with rich attribute and subject annotations from 438 subjects. FLICKR-AES: 40k Creative Commons Flickr images rated by crowd workers, not by the photo owners — [PARA paper, arXiv 2203.16754](https://arxiv.org/pdf/2203.16754); [Ren et al., ICCV 2017 "Personalized Image Aesthetics"](https://openaccess.thecvf.com/content_ICCV_2017/papers/Ren_Personalized_Image_Aesthetics_ICCV_2017_paper.pdf)
- FLICKR-AES 10-shot / 100-shot SROCC as reported in the PRAC paper (secondary table, not verified against the originals):
  - USAR 0.525 / 0.552
  - PA-IAA 0.543 / 0.639. The same paper elsewhere lists PA-IAA as 0.443 / 0.562, so the two tables conflict.
  - Yun et al. (task vectors, ECCV 2024) 0.668 / 0.748
  - PRAC 0.692 / 0.778
  — [PRAC, arXiv 2607.15752](https://arxiv.org/pdf/2607.15752)
- PARA 10-shot / 100-shot SROCC (40 users): MTCL 0.695 / 0.713, PIAA-MIR 0.702 / 0.716, PRAC 0.707 / 0.733 — [PRAC, arXiv 2607.15752](https://arxiv.org/pdf/2607.15752)
- Yun & Choo (ECCV 2024) build personal models as weighted combinations of "task vectors" from generic aesthetics and quality datasets. They report zero-shot results comparable to few-shot protocols, sometimes exceeding a model trained directly on the target database — [arXiv 2407.07176](https://arxiv.org/pdf/2407.07176); [ECCV paper](https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/05680.pdf)
- Zhu et al. (IEEE TCYB 2020/22) frame PIAA as meta-learning with bilevel gradient optimization, treating each user as a few-shot task — [Zhu et al., TCYB](https://zhuhancheng.github.io/Hancheng_files/files/2020-TCYB.pdf)
- Personality-assisted multi-task learning (PA-IAA) jointly learns generic and personal aesthetics — [Li et al. 2020](https://ise.thss.tsinghua.edu.cn/mig/2020-6.pdf)
- Ryu & Yanaka (2026): "linear personalization" is a user-specific linear transform on frozen features, fit with ridge regression and no fine-tuning. Linear-on-hidden-states consistently beats text-based baselines. An appendix repeats this with vision-encoder features. Code: github.com/ynklab/vlm-latent-piaa — [arXiv 2604.11374](https://arxiv.org/pdf/2604.11374); [ACL Findings 2026](https://aclanthology.org/2026.findings-acl.1706/)
- "CLIP knows image aesthetics" (Hentschel, Kobs, Hotho 2022): a linear probe on frozen CLIP features is competitive with fully fine-tuned ImageNet models on AVA while optimizing only 768 parameters — [Frontiers in AI 2022](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2022.976235/pdf)

### Inferences
- Benchmark SROCC does not translate directly to "picks the right frame in a burst". The benchmarks rank diverse images on a 1-5 scale, while burst selection is a top-1 choice among near-duplicates. Treat the papers only as evidence that (a) frozen-feature linear personalization works and (b) returns shrink after roughly 100 labels.
- Meta-learning and task-vector methods need server-side training on PARA/FLICKR-AES and full-backbone adaptation. For a solo developer they are not worth it versus a linear head on frozen CLIP embeddings. The gap between linear-probe and SOTA PIAA is likely a few SROCC points; this is an inference, since no paper found compares them directly at 10/100 shots.

### Gaps
- No source found that directly reports per-user CLIP linear-probe accuracy at 10/20/50/100 labels. The Ryu & Yanaka appendix (Tables 6-7) may have this but could not be fetched.
- Generic (GIAA, non-personalized) baseline SROCC on the same 37/40 test users could not be confirmed, so "gain vs generic" in absolute terms is unverified.
- No 20- or 50-shot results found; the literature uses only 10 and 100.

---

## 2. Practical baselines: generic aesthetic predictor + per-user head; pairwise ranking

### Takeaway
The most practical, permissive generic prior is a LAION-style linear or MLP aesthetic head on CLIP embeddings. A ViT-B/32 variant exists, which matches the encoder the app already ships. NIMA (Apache-2.0, LiteRT port exists) is the alternative. Q-Align and MUSIQ are impractical on-device. Personalization should be a per-user logistic/Bradley-Terry head trained on within-burst pairwise choices, initialized at the generic score.

### Cited Findings
- LAION Aesthetics Predictor V2 is a linear model (or small MLP) on CLIP ViT-L/14 image embeddings, trained on SAC, LAION-Logos and AVA. LAION found "a simple linear model on top of CLIP ViT/14" gave the most visually appealing results — [LAION blog](https://laion.ai/blog/laion-aesthetics/); [NVIDIA NeMo Curator docs](https://docs.nvidia.com/nemo/curator/0.25.7/apidocs/image/image.classifiers.aesthetic.html)
- The original LAION aesthetic-predictor repo has linear heads for ViT-B/32 (`sa_0_4_vit_b_32_linear.pth`), ViT-B/16 and ViT-L/14 — [shunk031 HF adapter code referencing the repo](https://huggingface.co/shunk031/aesthetics-predictor-v1-vit-large-patch14/blob/f7d7673c060f741079c76797b88e4b50d4458a2f/modeling_v1.py); [LAION datasets page](https://projects.laion.ai/laion-datasets/laion-aesthetic.html)
- A 2026 audit paper of the LAION-Aesthetics predictor raises concerns about whose taste it encodes — [arXiv 2601.09896](https://arxiv.org/pdf/2601.09896)
- NIMA: the idealo implementation is Apache-2.0. A LiteRT (TFLite) fp16 port runs on the GPU delegate, with about 173 ms reported for the aesthetic + technical models together on a Pixel 8a — [litert-community/NIMA-LiteRT](https://huggingface.co/litert-community/NIMA-LiteRT)
- MUSIQ: an ONNX export simplified to single-scale 224x224 exists. The export is Apache-2.0, but "original model weights are subject to their respective licenses" — [86Cao/IQA-ONNX-Models](https://huggingface.co/86Cao/IQA-ONNX-Models)
- Q-Align aesthetic is listed as MIT, but it is a large multimodal LLM scorer (pyiqa offers fp16/4-bit/8-bit). No mobile/TFLite conversion was found — [Q-Align HF paper page](https://huggingface.co/papers/2312.17090); [pyiqa Q-Align](https://iqa-pytorch.readthedocs.io/en/latest/autoapi/pyiqa/archs/qalign_arch/index.html)

### Inferences (recommended design)
- **Score function per photo:** `s(x) = g(x) + w_u·e(x) + v_u·q(x)`
  - `e(x)` is the L2-normalized 512-d CLIP ViT-B/32 embedding (already computed).
  - `g(x)` is the generic prior: the LAION ViT-B/32 linear head (verify the license) or the app's existing score.
  - `q(x)` is a small vector of interpretable burst-quality features: sharpness (Laplacian variance), exposure clipping, ML Kit eyes-open and smile probabilities, face size/centeredness, and a motion-blur estimate.
  - `w_u` (512) and `v_u` (about 10) are per-user and start at 0, so the day-1 behavior equals the generic model.
- **Training signal:** every time the user keeps photo A over B in the same burst or day group, that is a pairwise preference. Bradley-Terry / pairwise logistic loss: `P(A>B) = σ(s(A) - s(B))`. Train with L2 regularization (ridge toward 0, i.e. toward the generic prior) using online SGD or a closed-form refit over the full label history; a few hundred to a few thousand pairs times 522 dims takes milliseconds in Kotlin. Pairwise differences cancel out burst-level content (same scene), so the model learns what distinguishes frames. Absolute "keep/delete" labels can also be added as pointwise logistic terms.
- **Why not RankSVM:** it is equivalent in spirit, but logistic BT gives calibrated probabilities, which matter for "confidence" UI and active learning, and is trivially online.
- **Strong regularization while n is small:** use λ high when labels < 30 and decay it, or use a Bayesian logistic model (Laplace approximation) that also yields uncertainty for choosing which bursts to ask about.
- **Hold out a random 20% of new decisions** before they are used in training. They feed the honest agreement metric in section 6.

### Gaps
- License of the LAION aesthetic-predictor weights could not be confirmed. Check github.com/LAION-AI/aesthetic-predictor LICENSE (believed to be MIT, but unverified).
- No measured NIMA-vs-LAION comparison on burst selection found.

---

## 3. Burst best-shot selection: which signals matter

### Takeaway
Industry and academic burst selectors combine face-centric signals with low-level quality, and learn the combination from human picks. These signals are eyes open, smile/expression, and face visibility; the quality signals are sharpness/motion blur, exposure and lighting. The best published learned selector matched users' top-1 pick in only 64% of bursts and their top-3 in 86%. A flat "right in 9 of 10 bursts" top-1 target is therefore unrealistic as a generic baseline, and only plausible with personalization plus a lenient metric.

### Cited Findings
- Google Top Shot (Pixel 3) grew out of the Google Clips work. It runs a MobileNet-based model on hardware acceleration over frames before and after the shutter. It scores lighting, eyes open, smiling and emotional expression, plus a face-scoring model described as a Generalized Additive Model. Training data came from hundreds of volunteers choosing the best frames from clips of up to 90 frames — [Google Research blog, "Top Shot on Pixel 3"](https://www.research.google/blog/top-shot-on-pixel-3/); [Android Authority summary](https://androidauthority.com/google-pixel-3-top-shot-blog-936664); [9to5Google](https://9to5google.com/2018/12/20/google-ai-pixel-3-top-shot/)
- Wang et al. (Microsoft Research), "Real-time Burst Photo Selection Using a Light-Head Adversarial Network": a new dataset of about 15k manually captured bursts (selfies, portraits, pets, etc.). The model runs at 13 ms per frame on an iPhone 7. Its predicted best frame matched users' top-1 choice in 64.1% of bursts and fell within users' top-3 in 86.2%. Criteria range from low-level blur/exposure to high-level expression and pose — [arXiv 1803.07212](https://arxiv.org/pdf/1803.07212)
- Microsoft "Best of Burst" patent: an ML model ranks each image of a burst by predicted subjective goodness — [USPTO 10671895](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10671895)
- Burst Image Quality Assessment (BuIQA, AAAI 2026): 7,346 burst sequences, 45,827 images, 191,572 quality annotations across 10 downstream scenarios. It targets frame selection for restoration tasks (+0.33 dB PSNR), not human aesthetic choice — [arXiv 2511.07958](https://arxiv.org/abs/2511.07958); [AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/37621)
- Classical baseline (Stanford CS231A 2015): blurriness, brightness and fraction of eyes closed as features for burst selection — [report](https://fdalvi.github.io/research/unpublished-2015-stanford-231a/report.pdf); [CS231M report](https://web.stanford.edu/class/cs231m/projects/final-report-raghavan.pdf)
- ML Kit face detection with `CLASSIFICATION_MODE_ALL` returns `leftEyeOpenProbability`, `rightEyeOpenProbability` and `smilingProbability` in [0,1]. Classification is off by default. Performance mode trades fast vs accurate — [ML Kit FaceDetectorOptions (Android)](https://developers.google.cn/android/reference/com/google/mlkit/vision/face/FaceDetectorOptions?hl=fa); [ML Kit iOS options](https://developers.google.com/ml-kit/reference/ios/mlkitfacedetection/api/reference/Classes/MLKFaceDetectorOptions)

### Inferences
- Within a burst, CLIP embeddings of near-identical frames are very close, so a pure CLIP head may not separate "eyes closed" from "eyes open". The interpretable `q(x)` features carry most of the within-burst signal; CLIP carries the across-scene and day-level taste. Two practical rules:
  - Hard vetoes: any face with min(eyeOpen) < 0.3, or severe blur (relative to the burst's sharpest frame), drops the frame from top-1 unless every frame fails.
  - Normalize features within the burst (z-score or rank) before the head, because absolute sharpness varies by scene.
- Use ML Kit face detection only on the burst-candidate frames, not the whole gallery, to keep cost down. The repo already ships `faceres.tflite` for face recognition, so faces can additionally be weighted by "important person" (frequently kept people).

### Gaps
- No public numbers found on Apple Photos' key-photo selection internals.
- No public eyes-closed burst dataset found.

---

## 4. On-device embedding models: feasibility, sizes, latency, licenses

### Takeaway
Keep the already-integrated OpenAI CLIP ViT-B/32 (MIT) as the embedding backbone. It is permissive, already indexed, and adequate for a linear taste head. MobileCLIP/MobileCLIP2 are faster and better, but their weights are under Apple's research-oriented licenses (AMLR is explicitly non-commercial), so avoid them in a paid app. SigLIP 2 is Apache-2.0 but heavy (about 185 MB fp16 image tower). The MediaPipe image embedder (MobileNet-V3) is fast but ImageNet-trained, which makes it weaker for aesthetics. It fits a cheap dedup/near-duplicate pass.

### Cited Findings
- MobileCLIP2 model-card table (image + text params in M; latency in ms):
  - S0: 11.4 + 42.4 params, 1.5 + 1.6 ms, 71.5% IN zero-shot
  - S2: 3.6 ms image, 3.3 ms text
  - B: 86.3 + 63.4 params, 10.4 + 3.3 ms, 79.4%
  - S3: 125.1 + 123.6 params, 8.0 + 6.6 ms
  - S4: 321.6 + 123.6 params, 19.6 + 6.6 ms, 81.9%

  The S4 claims (matches SigLIP-SO400M/14 with 2x fewer params, 2.5x lower latency than DFN ViT-L/14) are measured on iPhone 12 Pro Max — [apple/MobileCLIP2-B card](https://huggingface.co/apple/MobileCLIP2-B/blob/main/README.md); [MobileCLIP2 paper, arXiv 2508.20691](https://arxiv.org/html/2508.20691v1)
- MobileCLIP2 HF cards are tagged `license: apple-amlr`. AMLR defines permitted use as "Research Purposes", i.e. non-commercial research, which "does not include any commercial exploitation, product development or use in any commercial product or service" — [apple mobileclip2 card](https://huggingface.co/apple/mobileclip2_coca_dfn2b_s13b_context77/blob/main/README.md); [AMLR text on HF](https://huggingface.co/qikp/openelm-tiny-random/blob/main/AMLR.txt); [AMLR license PR on MobileCLIP-B-LT](https://huggingface.co/apple/MobileCLIP-B-LT-OpenCLIP/discussions/3/files)
- MobileCLIP (v1) cards point to `LICENSE_weights_data` in github.com/apple/ml-mobileclip, labeled `apple-ascl`. Its exact commercial terms were not verified, and later PRs moved Apple repos to AMLR — [apple/ml-mobileclip](https://github.com/apple/ml-mobileclip); [apple/mobileclip_s0_timm discussion](https://huggingface.co/apple/mobileclip_s0_timm/discussions/4)
- Conflicting claim: a community ONNX export of MobileCLIP2-S0 is labeled MIT ("Apple Sample Code / MIT"). Its INT8 vision model is 11.3 MB, and its card cites about 25 ms per frame on CPU (hardware unnamed) and 112 ms for FP32. Apple's own tag (AMLR) should govern — [felixhrdyn/mobileclip2-s0-onnx](https://huggingface.co/felixhrdyn/mobileclip2-s0-onnx)
- SigLIP 2 base-patch16-224: Apache-2.0, about 375M params for both towers. A LiteRT community conversion of the image tower is 185 MB FP16 and outputs a 768-d embedding. Qualcomm AI Hub lists SigLIP2 as "not supported on any Mobile chipset" — [litert-community/SigLIP2-base-patch16-224](https://huggingface.co/litert-community/SigLIP2-base-patch16-224); [Keras SigLIP2](https://huggingface.co/keras/siglip2_base_patch16_224); [Qualcomm AI Hub](https://aihub.qualcomm.com/mobile/models/siglip2)
- MediaPipe Image Embedder (MobileNet-V3 small/large, 224x224, float32, ImageNet-trained) on Pixel 6:
  - small: 3.94 ms CPU / 7.83 ms GPU
  - large: 9.75 ms CPU / 9.08 ms GPU

  — [MediaPipe Image Embedder guide](https://ai.google.dev/mediapipe/solutions/vision/image_embedder)
- OpenAI CLIP on Qualcomm AI Hub (ONNX, NPU): about 174 ms on Galaxy S23 vs about 17 ms on a Snapdragon 8 Elite reference device. These are flagship/NPU numbers, not mid-range CPU — [qualcomm/OpenAI-Clip](https://huggingface.co/qualcomm/OpenAI-Clip)
- A CLIP ViT-B/32 image tower ExecuTorch export lists int8-dynamic XNNPACK at 95.9 MB. An unlabeled latency-like column shows 18.4 (int8) vs 19.0 (fp32), so int8 gives little speedup there. Device and unit are not stated — [mlboydaisuke/CLIP-ViT-B32-ExecuTorch](https://huggingface.co/mlboydaisuke/CLIP-ViT-B32-ExecuTorch)
- In an Android CLIP ViT-B/32 int8 demo, int8 loses about 0.05-0.11 (fraction) on CIFAR-100 vs fp32 — [greyovo/CLIP-android-demo](https://github.com/greyovo/CLIP-android-demo)
- TinyCLIP-ViT-8M-16-Text-3M ONNX conversion is tagged MIT. It is a possible permissive, smaller CLIP, but its accuracy was not verified — [onnx-community TinyCLIP via mixpeek](https://mixpeek.com/model/onnx-community/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M-ONNX)

### Inferences
- **Recommendation: no new backbone.** Reuse `clip_vision_q.onnx` (ViT-B/32, MIT) embeddings for the taste head, so there is zero added inference. Add only cheap per-photo quality features and ML Kit faces for burst candidates. If a future upgrade is wanted, SigLIP 2 (Apache-2.0) is the clean-license path, but at 185 MB and several times the compute it is not justified for a linear head.
- Expected ViT-B/32 int8 CPU latency on a mid-range phone (Snapdragon 7-series / Dimensity 7000-class) is roughly 40-120 ms per image with 4 threads. This is an estimate extrapolated from the 25 ms (MobileCLIP2-S0, unnamed CPU) and 112 ms (fp32) data points and from ViT-B/32's ~4.4 GFLOPs, not a measured figure. **Measure it in-app** by logging ms per image from `ClipIndex`.

### Gaps
- No published MobileCLIP or CLIP ViT-B/32 latency measured with ONNX Runtime on a named mid-range Android SoC was found.
- The exact commercial terms of `apple-ascl` (MobileCLIP v1 weights) remain unverified; read the `LICENSE_weights_data` file directly.

---

## 5. Incremental indexing for large galleries; throughput and thermal

### Takeaway
Index once, incrementally:
- key by MediaStore ID + DATE_MODIFIED (plus an optional dHash);
- process only new/changed items in a WorkManager (or the existing foreground `BackgroundAnalysisService`) job constrained to charging/idle/battery-not-low;
- pace the work via `PowerManager` thermal status/headroom.

At an estimated ~10-20 photos/s end-to-end on mid-range devices, 2,000 photos take about 2-4 minutes when cool, and longer under throttling. Burst grouping by timestamp is near-free.

### Cited Findings
- `PowerManager.getThermalHeadroom(forecastSeconds)` returns 0.0 (no throttling) to 1.0 (heavy throttling) and can forecast ahead. Google's heuristic: about 0.95 maps to roughly THERMAL_STATUS_MODERATE or higher, and >1.0 to SEVERE or worse, meaning reduce workload immediately. On some devices, calling it more often than about once per 10 s returns NaN. A high headroom reading paired with status NONE can mean a stale status — [Android ADPF Thermal API](https://developer.android.com/games/optimize/adpf/thermal)
- `THERMAL_STATUS_MODERATE` = moderate throttling where UX is not largely impacted. `addThermalStatusListener` notifies on status change — [PowerManager reference](https://developer.android.com/reference/android/os/PowerManager.html)
- MediaPipe MobileNet-V3 small embedder runs in 3.94 ms CPU on Pixel 6 — usable as a cheap near-duplicate pass — [MediaPipe guide](https://ai.google.dev/mediapipe/solutions/vision/image_embedder)
- Repo context: `ClipIndex.kt` already persists embeddings in `clip_index.bin` keyed by media ID, and the app has `BackgroundAnalysisService.kt` and `CleanReminderWorker.kt` in `/home/user/Lumin-Culler/android/app/src/main/java/com/luminculler/app/plugins/` (local file listing).

### Inferences (recommended pipeline)
1. **Change detection:** query MediaStore for `_ID, DATE_MODIFIED, SIZE` greater than the last checkpoint. Cache `{id, dateModified} → embedding, quality features, dHash`, and re-embed only on change. A 64-bit dHash from a 9x8 thumbnail costs well under 1 ms and catches edits and duplicates.
2. **Decode cost dominates:** always decode via `ContentResolver.loadThumbnail(uri, Size(256,256))` (API 29+), or `inSampleSize` to about 256 px. Never decode full 12-50 MP frames. Decode on 2 threads while ORT runs on another 2-4 threads.
3. **Grouping:** form bursts and "moments" by capture time (e.g. gap < 2-3 s plus CLIP cosine > ~0.9 for bursts) before any heavy work. Run ML Kit faces and the sharpness features only on frames that belong to a group of 2 or more, where a choice is needed.
4. **Budget (estimate):** per photo about 15-30 ms thumbnail decode + 40-120 ms CLIP int8 + 2-5 ms quality features. With 2 parallel workers that is about 10-20 photos/s, so a 2,000-photo first pass takes about 2-4 min when cool and 5-8 min under thermal throttling. Steady-state daily cost (e.g. 50 new photos) is a few seconds. **These are unmeasured estimates; benchmark on a Snapdragon 7-series / Galaxy A5x-class device.**
5. **Thermal policy:**
   - Poll headroom at most every 10 s.
   - When headroom > 0.8 or status >= MODERATE, drop to 1 thread and add a sleep between batches.
   - At >= SEVERE, stop and reschedule.
   - Use WorkManager constraints `setRequiresCharging(true)` / `setRequiresBatteryNotLow(true)` for the bulk backfill. Do "today's photos" on demand in the foreground, where the user expects a short wait.
6. **Training the head** runs in milliseconds on decision events; persist the weights (about 2 KB) with the profile.

### Gaps
- No primary-source throughput figure for full gallery indexing on a mid-range Android phone was found.
- WorkManager-specific guidance for ML workloads (e.g. quotas for long-running workers on Android 14+) was not researched here.

---

## 6. Accuracy expectations, label counts, and how to evaluate/present agreement

### Takeaway
A generic learned burst selector achieves about 64% top-1 and 86% top-3 agreement with users. PIAA gains from 10 to 100 labels are modest. A realistic goal for "right in 9 of 10 bursts" is a lenient but honest metric: the user accepts the suggested pick (or it is within their kept set) in at least 90% of eligible bursts. That is measured on held-out, not-yet-trained decisions and excludes trivially easy bursts. Strict top-1 will likely be about 65-80%.

### Cited Findings
- Generic burst selector: top-1 64.1%, top-3 86.2% agreement with user choices — [Wang et al., arXiv 1803.07212](https://arxiv.org/pdf/1803.07212)
- PIAA: 10-shot to 100-shot improves SROCC by about +0.02 (PARA, MTCL 0.695 to 0.713) up to about +0.09 (FLICKR-AES, PRAC 0.692 to 0.778) — [PRAC, arXiv 2607.15752](https://arxiv.org/pdf/2607.15752)
- Zero-shot / task-vector personalization can match few-shot, indicating that a strong prior matters more than many user labels — [Yun & Choo, arXiv 2407.07176](https://arxiv.org/pdf/2407.07176)

### Inferences
- **Label counts (inferred, not from a source):**
  - About 0 labels: the generic prior plus hard vetoes on eyes and blur.
  - About 20-30 pairwise choices (the existing "Învață-mă" pair test): enough to fit the ~10 interpretable `v_u` weights reliably, e.g. "prefers candid over posed" or "tolerates blur".
  - About 100-200 pairs: the 512-d `w_u` CLIP head starts to help, given strong ridge regularization.
  - Beyond about 300 pairs: diminishing returns, consistent with the small 10-to-100-shot PIAA gains.
- **Active learning:** in the onboarding pair test, show pairs where the current model is least certain (|P - 0.5| smallest) and diverse in CLIP space. This typically extracts more per label than random pairs; the specific gain is not sourced.
- **Continual/online learning:**
  - Do an SGD step per decision, plus a nightly full refit from the label log; keep the log so the model can be rebuilt.
  - Exponentially down-weight labels older than about 6-12 months to track taste drift.
  - Clamp each weight update to avoid one-off swings.
  - Store a "reset to generic" option.
  - Avoid feedback loops: implicit "accepted suggestion" labels are biased toward the model's own pick. Weight explicit overrides (the user picked a different frame) higher than passive accepts.
- **Metric to compute:**
  - **Agreement@1:** on bursts where the user made an explicit choice, the share where the model's top pick equals the user's kept frame. If several are kept, count a hit when the model's pick is among those kept.
  - Compute it only on decisions made **before** the model saw them (prequential / "test-then-train" evaluation), over a rolling window of the last 30-50 eligible bursts.
  - Report next to it the generic baseline's agreement on the same bursts, so the personalization lift is visible.
  - Exclude bursts where all frames are near-identical (CLIP cosine > 0.98 and quality spread tiny); otherwise the number is inflated.
- **Presentation:**
  - Something like "Lumin agreed with you in 43 of the last 50 groups (86%) — up from 71% when you started".
  - Show a confidence badge only for picks with P(top) > 0.7.
  - Hide the percentage until at least about 20 evaluated bursts, because of variance: ±~10 pp at n=50 (binomial approximation, inferred).
- **"9 of 10" target:** feasible as "suggested pick accepted, or within user's kept set" after personalization, for portrait/people bursts with clear eye/blur differences. Not credible as a strict top-1 promise across all bursts on day one, given 64% generic top-1 in the literature. Phrase marketing claims around measured, per-user agreement rather than a fixed number.

### Gaps
- No source quantifies per-user burst top-1 agreement as a function of number of personal labels; the curve above is an inference.
- No source found on active-learning gains specifically for PIAA pairwise elicitation.
