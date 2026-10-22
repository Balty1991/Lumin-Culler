# Prototip (temporar) al neclarității în profunzime și al Foto 3D din
# PhotoMagic.lensBlur / Photo3D, pe o poză publică. Scrie imaginile în jurnal
# ca base64, ca să poată fi văzute fără artefacte.
import base64, io, sys, time
import numpy as np, onnxruntime as ort, cv2
from PIL import Image

img = Image.open("m/portrait.jpg").convert("RGB")
img.thumbnail((1600, 1600))
src = np.asarray(img).astype(np.float32)
H, W = src.shape[:2]

# Adâncime (ca Depth.kt)
s = ort.InferenceSession("m/model_quantized.onnx")
sc = 518 / max(W, H)
w = max(14, round(W * sc / 14) * 14); h = max(14, round(H * sc / 14) * 14)
x = np.asarray(img.resize((w, h), Image.BILINEAR), np.float32) / 255
x = ((x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]).transpose(2, 0, 1)[None].astype(np.float32)
t = time.time(); raw = s.run(None, {"pixel_values": x})[0].squeeze(); print("depth", raw.shape, round(time.time() - t, 2))
lo, hi = np.percentile(raw, 2), np.percentile(raw, 98)
near = np.clip((raw - lo) / (hi - lo), 0, 1)
d = cv2.resize((near * 255).astype(np.uint8), (W, H), interpolation=cv2.INTER_LINEAR).astype(np.float32)

# Masca persoanei (selfie_segmenter, ca PhotoMagic.personMask)
import ai_edge_litert.interpreter as tfl
it = tfl.Interpreter(model_path="m/selfie_segmenter.tflite"); it.allocate_tensors()
i0 = it.get_input_details()[0]; o0 = it.get_output_details()[0]
it.set_tensor(i0["index"], (np.asarray(img.resize((256, 256)), np.float32) / 255)[None]); it.invoke()
mask = cv2.resize(it.get_tensor(o0["index"])[0, :, :, 0], (W, H))

focus = d[mask > 0.63].mean() if (mask > 0.63).any() else np.percentile(d, 75)
lum = src @ [0.3, 0.6, 0.1]
f = np.where(lum >= 200, 1 + (lum - 200) / 55 * 0.5, 1.0)[..., None]
glow = np.clip(src * f, 0, 255)
def level(div, passes):
    sm = cv2.resize(glow, (max(4, W // div), max(4, H // div)), interpolation=cv2.INTER_AREA)
    for _ in range(passes): sm = cv2.blur(sm, (3, 3))
    return cv2.resize(sm, (W, H), interpolation=cv2.INTER_LINEAR)
levels = [src, level(5, 1), level(10, 2), level(18, 2)]
diff = d - focus
a = np.where(diff < 0, -diff / 70, diff / 140) * (1 - mask)
a = np.clip(a, 0, 1) * 3
i = np.minimum(a.astype(int), 2); fr = (a - i)[..., None]
L = np.stack(levels)
yy, xx = np.mgrid[0:H, 0:W]
out = L[i, yy, xx] * (1 - fr) + L[i + 1, yy, xx] * fr

def dump(name, arr, size=420):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)); im.thumbnail((size, size))
    b = io.BytesIO(); im.save(b, "JPEG", quality=70)
    e = base64.b64encode(b.getvalue()).decode()
    print(f"BEGIN {name} {len(e)}")
    for k in range(0, len(e), 900): print(e[k:k + 900])
    print(f"END {name}")

sheet = np.concatenate([src, np.repeat(d[..., None], 3, 2), out], 1)
dump("lens", sheet, 900)

# Foto 3D: grilă deformată după adâncime (ca drawBitmapMesh în Photo3D), 3 cadre.
frames = []
for e in [0.0, 0.5, 1.0]:
    zoom = 1.0 + 0.10 * e * (d / 255)
    panx = 0.03 * W * np.sin(e * np.pi) * (d / 255 - 0.3)
    pany = -0.012 * H * e * (d / 255 - 0.3)
    cx, cy = W / 2, H / 2
    # inversare aproximativă: de unde vine pixelul care ajunge în (xx, yy)
    mx = cx + (xx - cx - panx) / (1.02 + zoom - 1)
    my = cy + (yy - cy - pany) / (1.02 + zoom - 1)
    frames.append(cv2.remap(src, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT))
dump("3d", np.concatenate(frames, 1), 900)
