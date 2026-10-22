"""
Convertește modelul FaceRes (Human.js, licență MIT) din formatul TF.js în
TFLite, pentru recunoașterea fețelor nativă din „Cum a crescut”.

Graful e un MobileNet v1 simplu; îl refacem operație cu operație din JSON,
cu greutățile din .bin (stocate float16), și păstrăm doar ieșirea de 1024 de
valori (global_pooling/Mean) — descriptorul pe care aplicația web îl
compară deja, cu aceleași praguri.

Rulare (o singură dată; rezultatul se pune în assets):
    python scripts/convert_faceres.py \
        node_modules/@vladmandic/human/models/faceres.json \
        android/app/src/main/assets/faceres.tflite
Cere tensorflow (cpu ajunge).
"""
import base64
import json
import os
import sys

import numpy as np
import tensorflow as tf


def load(model_json):
    with open(model_json) as f:
        d = json.load(f)
    base = os.path.dirname(model_json)
    weights = {}
    for group in d["weightsManifest"]:
        blob = b"".join(open(os.path.join(base, p), "rb").read() for p in group["paths"])
        offset = 0
        for w in group["weights"]:
            shape = w["shape"]
            n = int(np.prod(shape)) if shape else 1
            q = w.get("quantization")
            if q and q["dtype"] == "float16":
                arr = np.frombuffer(blob, dtype=np.float16, count=n, offset=offset).astype(np.float32)
                offset += n * 2
            elif w["dtype"] == "int32":
                arr = np.frombuffer(blob, dtype=np.int32, count=n, offset=offset)
                offset += n * 4
            else:
                arr = np.frombuffer(blob, dtype=np.float32, count=n, offset=offset)
                offset += n * 4
            weights[w["name"]] = arr.reshape(shape)
    return d["modelTopology"]["node"], weights


def attr_list(node, key):
    return [int(x) for x in node["attr"][key]["list"]["i"]]


def attr_str(node, key):
    return base64.b64decode(node["attr"][key]["s"]).decode()


def build(nodes, weights, output="global_pooling/Mean"):
    consts = {k: tf.constant(v) for k, v in weights.items()}

    @tf.function(input_signature=[tf.TensorSpec([1, 224, 224, 3], tf.float32, name="input")], autograph=False)
    def model(x):
        # Nodurile din JSON sunt deja în ordine topologică: le evaluăm pe rând,
        # fără recursivitate (graful are ~280 de noduri în lanț).
        vals = {}

        def get(name):
            name = name.split(":")[0].lstrip("^")
            return vals[name] if name in vals else consts[name]

        for n in nodes:
            op = n["op"]
            ins = [i for i in n.get("input", []) if not i.startswith("^")]
            if op == "Const":
                continue
            if op == "Placeholder":
                out = x
            elif op == "Conv2D":
                out = tf.nn.conv2d(get(ins[0]), get(ins[1]), attr_list(n, "strides"), attr_str(n, "padding"),
                                   dilations=attr_list(n, "dilations"))
            elif op == "DepthwiseConv2dNative":
                out = tf.nn.depthwise_conv2d(get(ins[0]), get(ins[1]), attr_list(n, "strides"), attr_str(n, "padding"),
                                             dilations=attr_list(n, "dilations")[1:3])
            elif op == "Add":
                out = get(ins[0]) + get(ins[1])
            elif op == "Mul":
                out = get(ins[0]) * get(ins[1])
            elif op == "Relu":
                out = tf.nn.relu(get(ins[0]))
            elif op == "Minimum":
                out = tf.minimum(get(ins[0]), tf.cast(get(ins[1]), tf.float32))
            elif op == "Maximum":
                out = tf.maximum(get(ins[0]), tf.cast(get(ins[1]), tf.float32))
            elif op == "Mean":
                out = tf.reduce_mean(get(ins[0]), axis=get(ins[1]), keepdims=n["attr"]["keep_dims"]["b"])
            else:
                continue  # capetele de vârstă/gen nu ne trebuie
            vals[n["name"]] = out
            if n["name"] == output:
                break
        return {"embedding": vals[output]}

    return model


def main():
    src, dst = sys.argv[1], sys.argv[2]
    nodes, weights = load(src)
    model = build(nodes, weights)
    probe = np.random.RandomState(0).uniform(0, 255, (1, 224, 224, 3)).astype(np.float32)
    ref = model(probe)["embedding"].numpy()
    conv = tf.lite.TFLiteConverter.from_concrete_functions([model.get_concrete_function()], model)
    # Greutățile erau deja float16 în fișierul TF.js: le păstrăm așa (fișier de 2× mai mic).
    conv.optimizations = [tf.lite.Optimize.DEFAULT]
    conv.target_spec.supported_types = [tf.float16]
    data = conv.convert()
    with open(dst, "wb") as f:
        f.write(data)
    it = tf.lite.Interpreter(model_content=data)
    it.allocate_tensors()
    it.set_tensor(it.get_input_details()[0]["index"], probe)
    it.invoke()
    got = it.get_tensor(it.get_output_details()[0]["index"])
    print("scris", dst, len(data), "octeți; ieșire", got.shape, "dif. max față de TF:", float(np.abs(got - ref).max()))


if __name__ == "__main__":
    main()
