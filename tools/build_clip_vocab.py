"""Pregătește conceptele căutării în poze (rulează în CI, la build).

Codează fiecare concept din tools/search_vocab.tsv cu partea de text a lui
CLIP (OpenAI, MIT; export ONNX Xenova/clip-vit-base-patch32) și scrie
android/app/src/main/assets/clip_vocab.json: pentru fiecare concept, numele
în engleză, cuvintele în română și vectorul normalizat (float16, base64).
Pe telefon rămâne doar partea de imagine a modelului.

Folosire: python tools/build_clip_vocab.py <text_model.onnx> <tokenizer.json> <ieșire.json> [poze de verificat...]
"""
import base64, json, sys
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

text_model, tok_path, out_path, *probe = sys.argv[1:]
tok = Tokenizer.from_file(tok_path)
sess = ort.InferenceSession(text_model)
names = [i.name for i in sess.get_inputs()]
out_name = next((o.name for o in sess.get_outputs() if o.name == "text_embeds"), sess.get_outputs()[0].name)

def encode(text):
    ids = tok.encode(text).ids
    feed = {"input_ids": np.array([ids], dtype=np.int64)}
    if "attention_mask" in names:
        feed["attention_mask"] = np.ones((1, len(ids)), dtype=np.int64)
    v = sess.run([out_name], feed)[0][0].astype(np.float32)
    return v / np.linalg.norm(v)

items = []
for line in open("tools/search_vocab.tsv", encoding="utf-8"):
    if not line.strip() or line.startswith("#"):
        continue
    en, ro = line.rstrip("\n").split("\t")
    # Media a două formulări dă un vector mai stabil decât una singură.
    v = encode(f"a photo of {en}") + encode(f"a picture of {en}")
    v = v / np.linalg.norm(v)
    items.append({"en": en, "ro": [w.strip() for w in ro.split(",") if w.strip()],
                  "v": base64.b64encode(v.astype(np.float16).tobytes()).decode()})

json.dump({"dim": len(v), "items": items}, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
print(f"{len(items)} concepte, dimensiune {len(v)}")

# Verificare: pozele date ca argumente, cu primele 5 concepte găsite.
if probe:
    vis = ort.InferenceSession(probe[0])
    vin = vis.get_inputs()[0].name
    vout = next((o.name for o in vis.get_outputs() if o.name == "image_embeds"), vis.get_outputs()[0].name)
    from PIL import Image
    M = np.stack([np.frombuffer(base64.b64decode(i["v"]), dtype=np.float16).astype(np.float32) for i in items])
    for path in probe[1:]:
        im = Image.open(path).convert("RGB")
        s = 224 / min(im.size)
        im = im.resize((round(im.size[0] * s), round(im.size[1] * s)), Image.BICUBIC)
        l, t = (im.size[0] - 224) // 2, (im.size[1] - 224) // 2
        x = (np.asarray(im.crop((l, t, l + 224, t + 224)), np.float32) / 255 - [0.48145466, 0.4578275, 0.40821073]) / [0.26862954, 0.26130258, 0.27577711]
        e = vis.run([vout], {vin: x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
        e = e / np.linalg.norm(e)
        sims = M @ e
        top = np.argsort(-sims)[:5]
        print(path, [(items[k]["en"], round(float(sims[k]), 3)) for k in top])
