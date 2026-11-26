"""
Pisică sau câine, când animalul stă lângă oameni (raportat: pisica alb-negru lângă fetiță ieșea
„câine” și la ML Kit, și la CLIP cu „a photo of a cat/dog”). Compară regula de acum cu fraze
de scenă („a child with a cat”) pe COCO val2017: poze cu oameni + exact una dintre specii.
Tipărește vectorii text aleși (float16, base64) ca să intre în src/core/clip/clipLabels.json.
"""
import base64, io, json, os, random, zipfile, urllib.request
import numpy as np, torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor, CLIPTokenizer

OUT = os.environ.get("GITHUB_STEP_SUMMARY", "/dev/stdout")
random.seed(3)
def get(url):
    with urllib.request.urlopen(url, timeout=180) as r: return r.read()

lab = json.load(open("src/core/clip/clipLabels.json"))
keys = lab["keys"]
T = np.frombuffer(base64.b64decode(lab["text"]), dtype=np.float16).astype(np.float32).reshape(len(keys), 512)

z = zipfile.ZipFile(io.BytesIO(get("http://images.cocodataset.org/annotations/annotations_trainval2017.zip")))
inst = json.loads(z.read("annotations/instances_val2017.json"))
imgs = {i["id"]: i for i in inst["images"]}
cats = {}
for a in inst["annotations"]: cats.setdefault(a["image_id"], set()).add(a["category_id"])
ids = sorted(imgs)
pc = [i for i in ids if {1, 17} <= cats.get(i, set()) and 18 not in cats[i]]
pd = [i for i in ids if {1, 18} <= cats.get(i, set()) and 17 not in cats[i]]
ac = [i for i in ids if 17 in cats.get(i, set()) and 1 not in cats[i] and 18 not in cats[i]]
ad = [i for i in ids if 18 in cats.get(i, set()) and 1 not in cats[i] and 17 not in cats[i]]
G = {"oameni+pisică": pc, "oameni+câine": random.sample(pd, min(150, len(pd))),
     "pisică singură": random.sample(ac, 80), "câine singur": random.sample(ad, 80)}

cm = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").eval()
cp = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
tok = CLIPTokenizer.from_pretrained("openai/clip-vit-base-patch32")
def emb_img(iids):
    out = []
    for k in range(0, len(iids), 16):
        pics = [Image.open(io.BytesIO(get(f"http://images.cocodataset.org/val2017/{imgs[i]['file_name']}"))).convert("RGB") for i in iids[k:k+16]]
        with torch.no_grad():
            v = cm.visual_projection(cm.vision_model(pixel_values=cp(images=pics, return_tensors="pt")["pixel_values"]).pooler_output)
        out.append(torch.nn.functional.normalize(v, dim=-1).numpy())
    return np.concatenate(out)
def emb_txt(ts):
    with torch.no_grad():
        t = tok(ts, padding=True, return_tensors="pt")
        v = cm.text_projection(cm.text_model(**t).pooler_output)
    return torch.nn.functional.normalize(v, dim=-1).numpy()

E = {g: emb_img(v) for g, v in G.items()}
def zs(e):
    L = e @ T.T * 100; L -= L.max(1, keepdims=True); P = np.exp(L); return P / P.sum(1, keepdims=True)
ci, di = keys.index("cat"), keys.index("dog")

scene = {
  "cat": ["a photo of a cat", "a photo of a person with a cat", "a photo of a child with a cat", "a photo of a kid petting a cat", "a photo of a cat lying next to a child", "a photo of a black and white cat"],
  "dog": ["a photo of a dog", "a photo of a person with a dog", "a photo of a child with a dog", "a photo of a kid petting a dog", "a photo of a dog lying next to a child", "a photo of a black and white dog"],
}
vc = emb_txt(scene["cat"]).mean(0); vc /= np.linalg.norm(vc)
vd = emb_txt(scene["dog"]).mean(0); vd /= np.linalg.norm(vd)

lines = ["## Pisică sau câine lângă oameni (COCO val2017)", "", f"Poze: " + ", ".join(f"{g} {len(v)}" for g, v in G.items()), "",
         "| regulă | " + " | ".join(G) + " |", "|---|" + "---|" * len(G)]
def row(name, f):
    cells = []
    for g, e in E.items():
        want = "pisică" in g
        guess = f(e)  # True = pisică
        cells.append(f"{100 * (guess == want).mean():.0f}%")
    lines.append(f"| {name} | " + " | ".join(cells) + " |")
row("acum: p(cat) > p(dog)", lambda e: zs(e)[:, ci] > zs(e)[:, di])
row("scenă: medie fraze", lambda e: e @ vc > e @ vd)
for m in (0.002, 0.005):
    row(f"scenă, marjă {m}", lambda e, m=m: (e @ vc - e @ vd) > -m)
lines.append("")
lines.append("Procent corect (pisică vs câine) pe fiecare grup.")
def b64(v): return base64.b64encode(v.astype(np.float16).tobytes()).decode()
lines += ["", "```", "CAT_SCENE=" + b64(vc), "DOG_SCENE=" + b64(vd), "```"]
txt = "\n".join(lines); print(txt); open(OUT, "a").write(txt + "\n")
