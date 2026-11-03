"""Listează și inspectează modelele candidate pentru editorul de pe telefon."""
import json, os, requests

REPOS = ['andraniksargsyan/migan', 'litert-community/MI-GAN-512-Places2-LiteRT', 'mlboydaisuke/zero-dce-litert', 'chili-raw/chiliraw-models']
os.makedirs('m', exist_ok=True)

def interp(path):
    try:
        from ai_edge_litert.interpreter import Interpreter
    except Exception:
        from tflite_runtime.interpreter import Interpreter
    it = Interpreter(model_path=path); it.allocate_tensors()
    for d in it.get_input_details(): print('   IN ', d['name'], d['shape'].tolist(), d['dtype'].__name__)
    for d in it.get_output_details(): print('   OUT', d['name'], d['shape'].tolist(), d['dtype'].__name__)

for repo in REPOS:
    print('=====', repo)
    info = requests.get(f'https://huggingface.co/api/models/{repo}', timeout=60).json()
    print('license', (info.get('cardData') or {}).get('license'))
    files = [s['rfilename'] for s in info.get('siblings', [])]
    print('files', files)
    readme = requests.get(f'https://huggingface.co/{repo}/resolve/main/README.md', timeout=60).text
    print(readme[:3000])
    for f in files:
        if f.endswith('.tflite') or f.endswith('.onnx'):
            url = f'https://huggingface.co/{repo}/resolve/main/{f}'
            r = requests.get(url, timeout=300)
            p = os.path.join('m', f.replace('/', '_'))
            open(p, 'wb').write(r.content)
            print('--', f, len(r.content), 'bytes', url)
            if f.endswith('.tflite'):
                try: interp(p)
                except Exception as e: print('   err', e)
            else:
                import onnx
                m = onnx.load(p)
                for i in m.graph.input: print('   IN ', i.name, [d.dim_value for d in i.type.tensor_type.shape.dim])
                for o in m.graph.output: print('   OUT', o.name, [d.dim_value for d in o.type.tensor_type.shape.dim])

print('===== xiongzhu666 sky repo')
r = requests.get('https://api.github.com/repos/xiongzhu666/Sky-Segmentation-and-Post-processing/contents', timeout=60)
print(json.dumps([(x['name'], x.get('size'), x.get('download_url')) for x in r.json()] if r.ok else r.text)[:3000])
lic = requests.get('https://api.github.com/repos/xiongzhu666/Sky-Segmentation-and-Post-processing/license', timeout=60)
print('license', lic.json().get('license', {}).get('spdx_id') if lic.ok else lic.status_code)
