"""
Comparație CLIP (ce folosește Cherrypic acum) vs. SigLIP2, la căutarea în cuvinte proprii.
300 de poze COCO val2017, câte o descriere scrisă de oameni; descrierea → poza corectă.
Măsoară recall@1/5/10 în engleză și în română (traducere automată OPUS-MT), plus viteza.
Rulează doar în CI (scripts/siglip-eval/**), nu intră în aplicație.
"""
import io, json, os, sys, time, zipfile, urllib.request
import numpy as np, torch
from PIL import Image

N = int(os.environ.get("N", "300"))
OUT = os.environ.get("GITHUB_STEP_SUMMARY", "/dev/stdout")
torch.set_num_threads(4)

def get(url):
    with urllib.request.urlopen(url, timeout=120) as r: return r.read()

print("COCO: descrieri…", flush=True)
z = zipfile.ZipFile(io.BytesIO(get("http://images.cocodataset.org/annotations/annotations_trainval2017.zip")))
ann = json.loads(z.read("annotations/captions_val2017.json"))
imgs = sorted(ann["images"], key=lambda x: x["id"])[:N]
cap = {}
for a in ann["annotations"]:
    cap.setdefault(a["image_id"], a["caption"].strip())
caps_en = [cap[i["id"]] for i in imgs]
print("COCO: poze…", flush=True)
pics = [Image.open(io.BytesIO(get(f"http://images.cocodataset.org/val2017/{i['file_name']}"))).convert("RGB") for i in imgs]

print("Traducere în română…", flush=True)
from transformers import MarianMTModel, MarianTokenizer
mt_tok = MarianTokenizer.from_pretrained("Helsinki-NLP/opus-mt-en-ro")
mt = MarianMTModel.from_pretrained("Helsinki-NLP/opus-mt-en-ro").eval()
caps_ro = []
with torch.no_grad():
    for k in range(0, N, 32):
        b = mt_tok(caps_en[k:k+32], return_tensors="pt", padding=True, truncation=True)
        caps_ro += mt_tok.batch_decode(mt.generate(**b, max_new_tokens=64), skip_special_tokens=True)
print("Exemplu:", caps_en[0], "→", caps_ro[0], flush=True)

def norm(x): x = np.asarray(x, dtype=np.float32); return x / np.linalg.norm(x, axis=1, keepdims=True)
def recall(T, I):
    s = T @ I.T; ranks = (-s).argsort(axis=1); gold = np.arange(len(T))
    pos = np.array([np.where(ranks[i] == gold[i])[0][0] for i in range(len(T))])
    return {k: round(float((pos < k).mean()) * 100, 1) for k in (1, 5, 10)}

results = {}
# A. CLIP ViT-B/32 (imagine) + clip-ViT-B-32-multilingual-v1 (text): exact ce are aplicația.
print("CLIP…", flush=True)
from transformers import CLIPModel, CLIPProcessor
from sentence_transformers import SentenceTransformer
cm = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").eval(); cp = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
t0 = time.time(); I = []
with torch.no_grad():
    for k in range(0, N, 32): I.append(cm.get_image_features(**cp(images=pics[k:k+32], return_tensors="pt")).numpy())
clip_ms = (time.time() - t0) / N * 1000
I = norm(np.concatenate(I))
mtxt = SentenceTransformer("sentence-transformers/clip-ViT-B-32-multilingual-v1")
results["CLIP ViT-B/32 + text multilingv (acum)"] = {
    "en": recall(norm(mtxt.encode(caps_en)), I), "ro": recall(norm(mtxt.encode(caps_ro)), I),
    "ms/poză (CPU CI)": round(clip_ms), "parametri imagine (M)": round(sum(p.numel() for p in cm.vision_model.parameters()) / 1e6)}

# B. SigLIP2 base (multilingv, un singur model pentru imagine și text).
print("SigLIP2…", flush=True)
from transformers import AutoModel, AutoProcessor
for name in ["google/siglip2-base-patch16-224", "google/siglip2-base-patch16-256"]:
    try:
        sm = AutoModel.from_pretrained(name).eval(); sp = AutoProcessor.from_pretrained(name)
    except Exception as e:
        print("lipsește", name, e); continue
    t0 = time.time(); J = []
    with torch.no_grad():
        for k in range(0, N, 32): J.append(sm.get_image_features(**sp(images=pics[k:k+32], return_tensors="pt")).numpy())
    ms = (time.time() - t0) / N * 1000
    J = norm(np.concatenate(J))
    def txt(c):
        out = []
        with torch.no_grad():
            for k in range(0, len(c), 64):
                b = sp(text=[x.lower() for x in c[k:k+64]], return_tensors="pt", padding="max_length", max_length=64, truncation=True)
                out.append(sm.get_text_features(**b).numpy())
        return norm(np.concatenate(out))
    results[name] = {"en": recall(txt(caps_en), J), "ro": recall(txt(caps_ro), J), "ms/poză (CPU CI)": round(ms),
                     "parametri imagine (M)": round(sum(p.numel() for p in sm.vision_model.parameters()) / 1e6),
                     "parametri text (M)": round(sum(p.numel() for p in sm.text_model.parameters()) / 1e6)}

lines = [f"## CLIP vs. SigLIP2 — {N} poze COCO, descriere → poză (recall %)", "",
         "| Model | EN R@1 | EN R@5 | EN R@10 | RO R@1 | RO R@5 | RO R@10 | ms/poză | param. |", "|---|---|---|---|---|---|---|---|---|"]
for k, v in results.items():
    lines.append(f"| {k} | {v['en'][1]} | {v['en'][5]} | {v['en'][10]} | {v['ro'][1]} | {v['ro'][5]} | {v['ro'][10]} | {v['ms/poză (CPU CI)']} | {v.get('parametri imagine (M)')}+{v.get('parametri text (M)', '—')} |")
lines += ["", "Exemple RO: " + " · ".join(caps_ro[:3])]
text = "\n".join(lines)
print(text)
with open(OUT, "a") as f: f.write(text + "\n")
json.dump(results, open("siglip-eval.json", "w"), ensure_ascii=False, indent=1)
