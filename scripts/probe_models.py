"""Formatul exact al modelelor alese: super-rezoluție (Real-ESRGAN x4v3) și decupaj (U²-Net p)."""
import requests
from ai_edge_litert.interpreter import Interpreter
for repo, f in [('litert-community/real-esrgan-x4v3-litert', 'realesr_general_x4v3.tflite'), ('abhimanyu666/u2nettflite', 'u2netp.tflite')]:
    info = requests.get(f'https://huggingface.co/api/models/{repo}', timeout=60).json()
    print('=====', repo, (info.get('cardData') or {}).get('license'))
    print(requests.get(f'https://huggingface.co/{repo}/resolve/main/README.md', timeout=60).text[:2500])
    r = requests.get(f'https://huggingface.co/{repo}/resolve/main/{f}', timeout=300)
    open('x.tflite', 'wb').write(r.content); print('--', f, len(r.content))
    it = Interpreter(model_path='x.tflite'); it.allocate_tensors()
    for d in it.get_input_details(): print('   IN ', d['shape'].tolist(), d['dtype'].__name__)
    for d in it.get_output_details(): print('   OUT', d['shape'].tolist(), d['dtype'].__name__)
