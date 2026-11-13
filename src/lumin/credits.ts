/**
 * lumin/credits.ts
 * Ce folosește aplicația și de la cine: modelele AI și bibliotecile native. Licențele MIT,
 * Apache, BSD și CC BY cer ca autorii și licența să apară odată cu aplicația; ecranul
 * „Licențe” din Setări le arată (verificate la sursă, vezi docs/MODEL_LICENSES.md).
 * Bibliotecile JavaScript vin separat, generate la build (licenses-deps.json).
 */
export type LicenseId = 'MIT' | 'Apache-2.0' | 'BSD-3-Clause' | 'CC-BY-4.0' | 'LGPL-2.1 / CDDL-1.0' | 'ML Kit' | 'Android SDK';

export interface Credit {
  name: string;
  /** Ce face în aplicație. */
  use: string;
  author: string;
  license: LicenseId;
  url: string;
}

export const MODEL_CREDITS: Credit[] = [
  { name: 'SCI (Self-Calibrated Illumination)', use: 'lowLight', author: 'Copyright (c) 2022 Tengyu Ma', license: 'MIT', url: 'https://github.com/vis-opt-group/SCI' },
  { name: 'CLIP ViT-B/32', use: 'clip', author: 'OpenAI', license: 'MIT', url: 'https://github.com/openai/CLIP' },
  { name: 'clip-ViT-B-32-multilingual-v1', use: 'search', author: 'sentence-transformers (UKP Lab)', license: 'Apache-2.0', url: 'https://huggingface.co/sentence-transformers/clip-ViT-B-32-multilingual-v1' },
  { name: 'Florence-2 base', use: 'describe', author: 'Microsoft', license: 'MIT', url: 'https://huggingface.co/microsoft/Florence-2-base-ft' },
  { name: 'FER+ (emotion-ferplus-8)', use: 'joy', author: 'Microsoft · ONNX Model Zoo', license: 'MIT', url: 'https://github.com/onnx/models' },
  { name: 'SFace', use: 'faces', author: 'Zhong et al. · OpenCV Zoo', license: 'Apache-2.0', url: 'https://github.com/opencv/opencv_zoo' },
  { name: 'MediaPipe (Face Landmarker, Pose, Selfie Segmenter, Image Embedder)', use: 'faces', author: 'Google', license: 'Apache-2.0', url: 'https://github.com/google-ai-edge/mediapipe' },
  { name: 'SlimSAM', use: 'select', author: 'Zigeng Chen et al.', license: 'Apache-2.0', url: 'https://github.com/czg1225/SlimSAM' },
  { name: 'MODNet', use: 'portrait', author: 'Zhanghan Ke et al.', license: 'Apache-2.0', url: 'https://github.com/ZHKKKe/MODNet' },
  { name: 'Depth Anything V2 Small', use: 'portrait', author: 'Lihe Yang et al.', license: 'Apache-2.0', url: 'https://github.com/DepthAnything/Depth-Anything-V2' },
  { name: 'MI-GAN', use: 'eraser', author: 'Picsart AI Research', license: 'MIT', url: 'https://github.com/Picsart-AI-Research/MI-GAN' },
  { name: 'LaMa', use: 'eraser', author: 'Samsung AI Center', license: 'Apache-2.0', url: 'https://github.com/advimman/lama' },
  { name: 'Real-ESRGAN', use: 'clarity', author: 'Xintao Wang et al.', license: 'BSD-3-Clause', url: 'https://github.com/xinntao/Real-ESRGAN' },
  { name: 'U²-Net', use: 'cutout', author: 'Xuebin Qin et al.', license: 'Apache-2.0', url: 'https://github.com/xuebinqin/U-2-Net' },
  { name: 'RIFE', use: 'film', author: 'Zhewei Huang et al.', license: 'MIT', url: 'https://github.com/hzwer/ECCV2022-RIFE' },
  { name: 'OPUS-MT', use: 'translate', author: 'Helsinki-NLP (Jörg Tiedemann et al.)', license: 'CC-BY-4.0', url: 'https://github.com/Helsinki-NLP/Opus-MT' }
];

export const NATIVE_CREDITS: Credit[] = [
  { name: 'ONNX Runtime', use: 'runtime', author: 'Microsoft', license: 'MIT', url: 'https://github.com/microsoft/onnxruntime' },
  { name: 'LiteRT (TensorFlow Lite)', use: 'runtime', author: 'Google', license: 'Apache-2.0', url: 'https://github.com/google-ai-edge/LiteRT' },
  { name: 'MediaPipe Tasks Vision', use: 'runtime', author: 'Google', license: 'Apache-2.0', url: 'https://github.com/google-ai-edge/mediapipe' },
  { name: 'ML Kit (etichete, obiecte, text, descriere)', use: 'runtime', author: 'Google', license: 'ML Kit', url: 'https://developers.google.com/ml-kit/terms' },
  { name: 'AndroidX, Play Billing, Play Review, Play App Update', use: 'runtime', author: 'Google', license: 'Android SDK', url: 'https://developer.android.com/studio/terms' },
  { name: 'Kotlin', use: 'runtime', author: 'JetBrains', license: 'Apache-2.0', url: 'https://github.com/JetBrains/kotlin' },
  { name: 'Capacitor', use: 'runtime', author: 'Ionic', license: 'MIT', url: 'https://github.com/ionic-team/capacitor' },
  { name: 'LibRaw (libraw-wasm)', use: 'raw', author: 'LibRaw LLC · Yanis Bouane', license: 'LGPL-2.1 / CDDL-1.0', url: 'https://github.com/LibRaw/LibRaw' }
];

/** Textul complet, inclus în aplicație, pentru licențele care îl cer. */
export const LICENSE_TEXT: Partial<Record<LicenseId, string>> = {
  'MIT': './licenses/MIT.txt',
  'Apache-2.0': './licenses/Apache-2.0.txt',
  'BSD-3-Clause': './licenses/BSD-3-Clause.txt'
};

export const LICENSE_URL: Partial<Record<LicenseId, string>> = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'LGPL-2.1 / CDDL-1.0': 'https://github.com/LibRaw/LibRaw/blob/master/COPYRIGHT'
};
