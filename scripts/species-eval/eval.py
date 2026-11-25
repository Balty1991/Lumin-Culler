"""
Căutarea „pisică”/„câine” din amprentele CLIP: ce prag prinde pozele cu pisica lângă oameni
fără să aducă poze fără animal. Poze COCO val2017 (adnotate de oameni), același CLIP ViT-B/32
ca aplicația și aceleași descrieri (src/core/clip/clipLabels.json). Doar în CI.
"""
import base64, io, json, os, random, zipfile, urllib.request
import numpy as np, torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

OUT = os.environ.get("GITHUB_STEP_SUMMARY", "/dev/stdout")
random.seed(7)
def get(url):
    with urllib.request.urlopen(url, timeout=180) as r: return r.read()

lab = json.load(open("src/core/clip/clipLabels.json"))
keys = lab["keys"]
T = np.frombuffer(base64.b64decode(lab["text"]), dtype=np.float16).astype(np.float32).reshape(len(keys), 512)
ANIMALS = ['dog', 'cat', 'bird', 'horse', 'bear', 'cow', 'sheep', 'duck', 'fish', 'elephant']
ai = [keys.index(a) for a in ANIMALS]

z = zipfile.ZipFile(io.BytesIO(get("http://images.cocodataset.org/annotations/annotations_trainval2017.zip")))
inst = json.loads(z.read("annotations/instances_val2017.json"))
imgs = {i["id"]: i for i in inst["images"]}
cats = {}; area = {}
for a in inst["annotations"]:
    cats.setdefault(a["image_id"], set()).add(a["category_id"])
    if a["category_id"] in (17, 18):
        im = imgs[a["image_id"]]
        f = a["area"] / (im["width"] * im["height"])
        area[(a["image_id"], a["category_id"])] = max(area.get((a["image_id"], a["category_id"]), 0), f)
ANIMAL_IDS = set(range(16, 26))
ids = sorted(imgs)
cat_person = [i for i in ids if 17 in cats.get(i, ()) and 1 in cats[i] and 18 not in cats[i]]
cat_alone = [i for i in ids if 17 in cats.get(i, ()) and 1 not in cats[i] and 18 not in cats[i]]
dog = [i for i in ids if 18 in cats.get(i, ()) and 17 not in cats[i]]
teddy = [i for i in ids if 88 in cats.get(i, ()) and not (cats[i] & ANIMAL_IDS)]
none = [i for i in ids if cats.get(i) and not (cats[i] & ANIMAL_IDS) and 88 not in cats[i]]
people_none = [i for i in none if 1 in cats[i]]
groups = {
    "pisică + oameni": random.sample(cat_person, min(80, len(cat_person))),
    "pisică singură": random.sample(cat_alone, 80),
    "câine": random.sample(dog, 100),
    "ursuleț de pluș, fără animal": random.sample(teddy, min(60, len(teddy))),
    "oameni, fără animal": random.sample(people_none, 200),
    "altele, fără animal": random.sample([i for i in none if 1 not in cats[i]], 120),
}

cm = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").eval()
cp = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
def embed(iids):
    out = []
    for k in range(0, len(iids), 16):
        pics = [Image.open(io.BytesIO(get(f"http://images.cocodataset.org/val2017/{imgs[i]['file_name']}"))).convert("RGB") for i in iids[k:k+16]]
        with torch.no_grad():
            px = cp(images=pics, return_tensors="pt")["pixel_values"]
            v = cm.visual_projection(cm.vision_model(pixel_values=px).pooler_output)
        out.append(torch.nn.functional.normalize(v, dim=-1).numpy())
    return np.concatenate(out)

def probs(E):
    L = E @ T.T * 100
    L -= L.max(axis=1, keepdims=True)
    P = np.exp(L); return P / P.sum(axis=1, keepdims=True)

def match(P, s, floor, share=0.0, ratio=0.0):
    A = P[:, ai]; k = ANIMALS.index(s)
    top = A.argmax(1) == k
    sp = A[:, k]
    other = np.delete(A, k, axis=1).max(1)
    sh = sp / np.maximum(A.sum(1), 1e-9)
    return top & (sp >= floor) & (sh >= share) & (sp >= ratio * other)

cands = [("acum (≥0,12)", 0.12, 0, 0), ("≥0,08", 0.08, 0, 0), ("≥0,05", 0.05, 0, 0), ("≥0,03", 0.03, 0, 0),
         ("≥0,03, dublu față de alt animal", 0.03, 0, 2), ("≥0,02, dublu", 0.02, 0, 2), ("≥0,01, dublu", 0.01, 0, 2),
         ("≥0,02, triplu", 0.02, 0, 3), ("≥0,01, triplu", 0.01, 0, 3)]
P = {g: probs(embed(v)) for g, v in groups.items()}
lines = ["## Căutarea „pisică” din amprente CLIP (COCO val2017)", "",
         "| regulă | " + " | ".join(groups) + " |", "|---|" + "---|" * len(groups)]
for name, fl, sh, ra in cands:
    row = [f"{100*match(P[g], 'cat', fl, sh, ra).mean():.0f}%" for g in groups]
    lines.append(f"| {name} | " + " | ".join(row) + " |")
lines += ["", "Procent din grup găsit la „pisică”: sus vrem mult pe primele două, puțin pe restul.", "",
          "### Câine, aceleași reguli", "", "| regulă | " + " | ".join(groups) + " |", "|---|" + "---|" * len(groups)]
for name, fl, sh, ra in cands:
    row = [f"{100*match(P[g], 'dog', fl, sh, ra).mean():.0f}%" for g in groups]
    lines.append(f"| {name} | " + " | ".join(row) + " |")
# Pisicile ratate: cât de mare era pisica în poză.
g = "pisică + oameni"; m = match(P[g], 'cat', 0.02, 0, 2)
fr = np.array([area[(i, 17)] for i in groups[g]])
lines += ["", f"Pisică + oameni, ratate la „≥0,02, dublu”: {int((~m).sum())}; suprafața pisicii (mediană) ratate {np.median(fr[~m]) if (~m).any() else 0:.3f} vs găsite {np.median(fr[m]) if m.any() else 0:.3f}"]
txt = "\n".join(lines); print(txt)
open(OUT, "a").write(txt + "\n")
