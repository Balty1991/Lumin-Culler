/**
 * server/src/index.ts
 * Serverul intermediar pentru efectele AI Lumin (Cloudflare Worker).
 *
 * De ce există: cheia fal.ai nu are voie să stea în aplicație (oricine ar
 * putea-o scoate din APK și ar cheltui pe banii noștri). Aplicația vorbește
 * doar cu serverul ăsta, care:
 *  - verifică cererea și limitele pe zi ale instalării;
 *  - nu depășește bugetul zilnic total (DAILY_BUDGET_USD);
 *  - trimite poza la fal.ai și păstrează doar adresele lucrării, 24 de ore;
 *  - NU salvează pozele: ele trec direct, ca data-URI, spre fal.ai.
 *
 * Rute:
 *   POST /v1/jobs        { kind, style?, image, installId } → { id }
 *   GET  /v1/jobs/:id    → { status: working|done|failed, url? }
 *   POST /v1/report      { id, reason } → raportare conținut (cerință Google Play pentru AI)
 */
import { admit, budgetKey, COST_USD, DEFAULT_MODELS, falRequest, mapStatus, quotaKey, resultUrl, validateCreate, type Kind } from './logic';

export interface Env {
  FAL_KEY: string;
  LIMITS: KVNamespace;
  DAILY_BUDGET_USD?: string;
  ALIVE_MODEL?: string;
  STYLE_MODEL?: string;
}

interface JobRecord {
  kind: Kind;
  statusUrl: string;
  responseUrl: string;
}

const DAY_S = 24 * 3600;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

async function readNumber(kv: KVNamespace, key: string): Promise<number> {
  const v = await kv.get(key);
  return v ? Number(v) || 0 : 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();

    if (request.method === 'POST' && url.pathname === '/v1/jobs') {
      let body: unknown;
      try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
      const v = validateCreate(body);
      if (!v.ok) return json({ error: v.error }, 400);
      const req = v.req;

      // Limite: contorul instalării și bugetul zilei. KV nu e atomic; la volumul
      // unei aplicații mici, o depășire cu o lucrare e acceptabilă.
      const qKey = quotaKey(req.installId, req.kind, now);
      const bKey = budgetKey(now);
      const [used, spent] = await Promise.all([readNumber(env.LIMITS, qKey), readNumber(env.LIMITS, bKey)]);
      const gate = admit(req.kind, used, spent, Number(env.DAILY_BUDGET_USD ?? '5'));
      if (!gate.ok) return json({ error: gate.error }, 429);

      const models = { alive: env.ALIVE_MODEL || DEFAULT_MODELS.alive, style: env.STYLE_MODEL || DEFAULT_MODELS.style };
      const { model, input } = falRequest(req, models);
      const fal = await fetch(`https://queue.fal.run/${model}`, {
        method: 'POST',
        headers: { authorization: `Key ${env.FAL_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(input)
      });
      if (!fal.ok) return json({ error: 'provider', status: fal.status }, 502);
      const sub = await fal.json() as { request_id?: string; status_url?: string; response_url?: string };
      if (!sub.request_id || !sub.status_url || !sub.response_url) return json({ error: 'provider' }, 502);

      const id = crypto.randomUUID();
      const record: JobRecord = { kind: req.kind, statusUrl: sub.status_url, responseUrl: sub.response_url };
      await Promise.all([
        env.LIMITS.put(`j:${id}`, JSON.stringify(record), { expirationTtl: DAY_S }),
        env.LIMITS.put(qKey, String(used + 1), { expirationTtl: 2 * DAY_S }),
        env.LIMITS.put(bKey, String(spent + COST_USD[req.kind]), { expirationTtl: 2 * DAY_S })
      ]);
      return json({ id });
    }

    const jobMatch = url.pathname.match(/^\/v1\/jobs\/([0-9a-f-]{36})$/);
    if (request.method === 'GET' && jobMatch) {
      const raw = await env.LIMITS.get(`j:${jobMatch[1]}`);
      if (!raw) return json({ error: 'not_found' }, 404);
      const job = JSON.parse(raw) as JobRecord;
      const auth = { authorization: `Key ${env.FAL_KEY}` };
      const st = await fetch(job.statusUrl, { headers: auth });
      if (!st.ok) return json({ status: 'working' });
      const status = mapStatus(((await st.json()) as { status?: string }).status);
      if (status !== 'done') return json({ status });
      const res = await fetch(job.responseUrl, { headers: auth });
      if (!res.ok) return json({ status: 'failed' });
      const out = resultUrl(job.kind, await res.json());
      return out ? json({ status: 'done', url: out }) : json({ status: 'failed' });
    }

    if (request.method === 'POST' && url.pathname === '/v1/report') {
      let body: { id?: string; reason?: string } = {};
      try { body = await request.json(); } catch { /* raport gol tot se păstrează */ }
      const key = `r:${now}:${crypto.randomUUID()}`;
      await env.LIMITS.put(key, JSON.stringify({ id: body.id ?? null, reason: String(body.reason ?? '').slice(0, 500) }), { expirationTtl: 90 * DAY_S });
      return json({ ok: true });
    }

    return json({ error: 'not_found' }, 404);
  }
};
