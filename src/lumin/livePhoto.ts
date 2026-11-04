import { registerPlugin } from '@capacitor/core';
import { weakDevice } from '../core/deviceClass';
import { portraitAvailable } from '../core/portraitEdit';
import { extensionFor, pickFilmMimeType as pickMimeType } from '../core/recapVideoRender';
import { loadEditable, originalUri } from './sharp';
import { startStoryMusic, type MusicMood } from './storyMusic';
import { audioMimeFor } from './storyVideo';
import type { BurstFilm } from './burstFilm';

/**
 * lumin/livePhoto.ts
 * „Poza vie”: dintr-o singură poză, o mișcare 3D de câteva secunde. Adâncimea
 * vine de la Depth Anything (același motor ca la Portret, pe telefon), iar
 * mișcarea o face placa video: ce e aproape se mișcă mai mult decât fundalul,
 * ca și cum camera ar pluti ușor prin scenă.
 */
interface DepthApi { depth(o: { imageUri: string }): Promise<{ depthBase64: string; side: number }> }
const Portrait = registerPlugin<DepthApi>('Portrait');

export type LiveMotion = 'orbit' | 'zoom' | 'sway';

export function livePhotoAvailable(): boolean {
  return portraitAvailable() && !!pickMimeType() && typeof WebGLRenderingContext !== 'undefined';
}

const VERT = `attribute vec2 p; varying vec2 uv; void main(){ uv = vec2(p.x*0.5+0.5, 0.5-p.y*0.5); gl_Position = vec4(p,0.0,1.0); }`;
// Pentru fiecare pixel: unde „era” în poză, după cât de aproape e (paralaxă);
// trei pași de rafinare, ca marginile obiectelor să nu se rupă.
const FRAG = `precision mediump float;
varying vec2 uv; uniform sampler2D img; uniform sampler2D dep;
uniform vec2 shift; uniform float zoom; uniform float focus;
void main(){
  vec2 c = (uv - 0.5) / zoom + 0.5;
  vec2 q = c;
  for (int i = 0; i < 3; i++) { float d = texture2D(dep, q).r; q = c - shift * (d - focus); }
  gl_FragColor = texture2D(img, clamp(q, 0.001, 0.999));
}`;

function shader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

function texture(gl: WebGLRenderingContext, unit: number, src: TexImageSource) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
}

/** Desenatorul: o pânză WebGL care arată poza la momentul t (0..1 dintr-o buclă). */
export interface LiveRenderer { canvas: HTMLCanvasElement; render: (t: number) => void }

export async function prepareLivePhoto(photoId: string, motion: LiveMotion, strength = 1): Promise<LiveRenderer | null> {
  const uri = await originalUri(photoId);
  if (!uri) return null;
  const [r, d] = await Promise.all([loadEditable(photoId, 1600), Portrait.depth({ imageUri: uri })]);
  if (!r?.img) return null;
  const depthImg = new Image();
  depthImg.src = `data:image/png;base64,${d.depthBase64}`;
  await depthImg.decode();
  const out = (await weakDevice()) ? 720 : 1080;
  const k = Math.min(1, out / Math.max(r.img.naturalWidth, r.img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(r.img.naturalWidth * k / 2) * 2;
  canvas.height = Math.round(r.img.naturalHeight * k / 2) * 2;
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  if (!gl) return null;
  // Poza la mărimea pânzei (texturi mai mici, desen mai rapid).
  const scaled = document.createElement('canvas');
  scaled.width = canvas.width; scaled.height = canvas.height;
  scaled.getContext('2d')!.drawImage(r.img, 0, 0, scaled.width, scaled.height);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  texture(gl, 0, scaled);
  texture(gl, 1, depthImg);
  gl.uniform1i(gl.getUniformLocation(prog, 'img'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'dep'), 1);
  const uShift = gl.getUniformLocation(prog, 'shift'), uZoom = gl.getUniformLocation(prog, 'zoom'), uFocus = gl.getUniformLocation(prog, 'focus');
  gl.viewport(0, 0, canvas.width, canvas.height);
  const amp = 0.028 * strength;
  const aspect = canvas.width / canvas.height;
  const render = (t: number) => {
    const a = t * Math.PI * 2;
    let sx = 0, sy = 0, zoom = 1.08;
    if (motion === 'orbit') { sx = Math.cos(a) * amp; sy = Math.sin(a) * amp * 0.6; }
    else if (motion === 'sway') { sx = Math.sin(a) * amp * 1.3; }
    else { zoom = 1.06 + (1 - Math.cos(a)) * 0.05 * strength; sy = (1 - Math.cos(a)) * amp * 0.35; }
    gl.uniform2f(uShift, sx / Math.max(1, aspect) , sy * Math.min(1, aspect));
    gl.uniform1f(uZoom, zoom);
    gl.uniform1f(uFocus, motion === 'zoom' ? 0.0 : 0.5);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  render(0);
  return { canvas, render };
}

const LOOP_S = 4;
const FPS = 30;

/** Înregistrează bucla (de două ori) ca film, cu muzică dacă se poate. */
export async function recordLivePhoto(r: LiveRenderer, music: 'none' | MusicMood, onProgress?: (f: number) => void): Promise<BurstFilm | null> {
  const mime = pickMimeType();
  if (!mime) return null;
  const total = LOOP_S * 2 * FPS;
  const withAudio = music !== 'none' ? audioMimeFor(mime) : null;
  const m = withAudio && music !== 'none' ? startStoryMusic(total * 1000 / FPS + 400, { mood: music }) : null;
  const video = r.canvas.captureStream(FPS);
  const stream = m ? new MediaStream([...video.getVideoTracks(), m.track]) : video;
  const used = m ? withAudio! : mime;
  const rec = new MediaRecorder(stream, { mimeType: used, videoBitsPerSecond: 16_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>(res => { rec.onstop = () => res(); });
  rec.start();
  const t0 = performance.now();
  await new Promise<void>(resolve => {
    const step = () => {
      const el = (performance.now() - t0) / 1000;
      if (el >= LOOP_S * 2) { resolve(); return; }
      r.render((el % LOOP_S) / LOOP_S);
      onProgress?.(el / (LOOP_S * 2));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  rec.stop();
  await done;
  m?.stop();
  const frames = LOOP_S * FPS;
  return {
    blob: new Blob(chunks, { type: used.split(';')[0] }), ext: extensionFor(used), music: m ? music : 'none',
    fps: FPS, width: r.canvas.width, height: r.canvas.height, count: frames,
    draw: (ctx, i) => { r.render((i % frames) / frames); ctx.drawImage(r.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height); }
  };
}
