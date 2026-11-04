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
// Pentru fiecare pixel: unde „era” în poză, după cât de aproape e (paralaxă), cu
// pivotul pe subiect (el stă pe loc, fundalul se mișcă: ca o cameră care se rotește
// în jurul lui). Adâncimea e „umflată” spre prim-plan (maximul din jur), ca marginile
// subiectului să rămână întregi și să se întindă fundalul, nu omul. Plus o ușoară
// profunzime de câmp (fundalul puțin estompat) și o vignetă: arată ca filmat, nu desenat.
const FRAG = `precision highp float;
varying vec2 uv; uniform sampler2D img; uniform sampler2D dep;
uniform vec2 shift; uniform float zoom; uniform float focus; uniform float push; uniform float dof; uniform vec2 px; uniform vec2 ipx;
float depthAt(vec2 p){
  float d = texture2D(dep, p).r;
  d = max(d, texture2D(dep, p + vec2(px.x * 2.0, 0.0)).r);
  d = max(d, texture2D(dep, p - vec2(px.x * 2.0, 0.0)).r);
  d = max(d, texture2D(dep, p + vec2(0.0, px.y * 2.0)).r);
  d = max(d, texture2D(dep, p - vec2(0.0, px.y * 2.0)).r);
  return d;
}
void main(){
  vec2 c = (uv - 0.5) / zoom + 0.5;
  vec2 q = c;
  for (int i = 0; i < 6; i++) {
    float d = depthAt(q);
    q = 0.5 + (c - 0.5) / (1.0 + push * (d - focus)) - shift * (d - focus);
  }
  q = clamp(q, 0.001, 0.999);
  float d = texture2D(dep, q).r;
  vec3 col = texture2D(img, q).rgb;
  float r = dof * clamp(focus - 0.15 - d, 0.0, 1.0);
  if (r > 0.0) {
    vec3 acc = col;
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.7853981;
      acc += texture2D(img, clamp(q + vec2(cos(a), sin(a)) * ipx * r * 6.0, 0.001, 0.999)).rgb;
    }
    col = acc / 9.0;
  }
  vec2 v = uv - 0.5;
  col *= 1.0 - 0.22 * dot(v, v) * 2.0;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Adâncimea subiectului: ce e mai aproape decât 85% din poză. */
function subjectDepth(depth: HTMLImageElement): number {
  try {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(depth, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    const v: number[] = [];
    for (let i = 0; i < d.length; i += 4) v.push(d[i] / 255);
    v.sort((x, y) => x - y);
    return Math.min(0.92, Math.max(0.45, v[Math.floor(v.length * 0.85)]));
  } catch { return 0.7; }
}

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
  const [r, d] = await Promise.all([loadEditable(photoId, 2048), Portrait.depth({ imageUri: uri })]);
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
  const ks = Math.min(1.5, Math.max(r.img.naturalWidth, r.img.naturalHeight) / Math.max(canvas.width, canvas.height));
  scaled.width = Math.round(canvas.width * ks); scaled.height = Math.round(canvas.height * ks);
  const sctx = scaled.getContext('2d')!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(r.img, 0, 0, scaled.width, scaled.height);
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
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const uShift = u('shift'), uZoom = u('zoom'), uFocus = u('focus'), uPush = u('push'), uDof = u('dof');
  gl.uniform2f(u('px'), 1 / depthImg.naturalWidth, 1 / depthImg.naturalHeight);
  gl.uniform2f(u('ipx'), 1 / canvas.width, 1 / canvas.height);
  gl.viewport(0, 0, canvas.width, canvas.height);
  // Subiectul = ce e aproape (al 85-lea procent din adâncimi): pivotul mișcării.
  const focus = subjectDepth(depthImg);
  const amp = 0.022 * strength;
  const aspect = canvas.width / canvas.height;
  // Curbă lină (fără porniri bruște) pentru bucla dus-întors.
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(x * Math.PI * 2);
  const render = (t: number) => {
    const a = t * Math.PI * 2;
    let sx = 0, sy = 0, push = 0;
    if (motion === 'orbit') { sx = Math.cos(a) * amp; sy = Math.sin(a) * amp * 0.55; }
    else if (motion === 'sway') { sx = Math.sin(a) * amp * 1.4; sy = Math.sin(a * 2) * amp * 0.15; }
    else { push = ease(t) * 0.12 * strength; sy = -ease(t) * amp * 0.25; }
    // Destul de aproape ca marginile pozei să nu se vadă niciodată.
    const zoom = 1.02 + Math.max(Math.abs(sx), Math.abs(sy)) * 2.4 + push * 0.35;
    gl.uniform2f(uShift, sx / Math.max(1, aspect), sy * Math.min(1, aspect));
    gl.uniform1f(uZoom, zoom);
    gl.uniform1f(uFocus, focus);
    gl.uniform1f(uPush, push);
    gl.uniform1f(uDof, strength > 1.2 ? 1.6 : 1.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  render(0);
  return { canvas, render };
}

const LOOP_S = 5;
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
