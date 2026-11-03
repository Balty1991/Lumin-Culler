"""Caută modele LiteRT pentru: cer (segmentare), claritate (super-rezoluție), fundal."""
import os, requests
os.makedirs('m', exist_ok=True)
for q in ['sky segmentation', 'super resolution litert', 'esrgan tflite', 'real-esrgan litert', 'background removal litert', 'u2net tflite', 'ade20k tflite', 'segformer litert', 'deeplab ade20k']:
    r = requests.get('https://huggingface.co/api/models', params={'search': q, 'limit': 12, 'full': 'true'}, timeout=60).json()
    print('=== search', q)
    for m in r:
        files = [s['rfilename'] for s in m.get('siblings', []) if s['rfilename'].endswith(('.tflite', '.onnx'))]
        if files: print('  ', m['id'], (m.get('cardData') or {}).get('license'), files[:6])

def interp(p):
    from ai_edge_litert.interpreter import Interpreter
    it = Interpreter(model_path=p); it.allocate_tensors()
    for d in it.get_input_details(): print('   IN ', d['shape'].tolist(), d['dtype'].__name__)
    for d in it.get_output_details(): print('   OUT', d['shape'].tolist(), d['dtype'].__name__)

for repo in ['litert-community/Real-ESRGAN-x4plus-LiteRT', 'litert-community/RMBG', 'qualcomm/Real-ESRGAN-x4plus', 'qualcomm/QuickSRNetSmall', 'qualcomm/ESRGAN']:
    info = requests.get(f'https://huggingface.co/api/models/{repo}', timeout=60)
    if not info.ok: print('missing', repo); continue
    info = info.json()
    files = [s['rfilename'] for s in info.get('siblings', [])]
    print('=====', repo, (info.get('cardData') or {}).get('license'), files[:20])
    for f in files:
        if f.endswith('.tflite'):
            r = requests.get(f'https://huggingface.co/{repo}/resolve/main/{f}', timeout=300)
            p = 'm/' + f.replace('/', '_'); open(p, 'wb').write(r.content); print('--', f, len(r.content))
            try: interp(p)
            except Exception as e: print('   err', e)
            break
