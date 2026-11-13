import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * scripts/licensesPlugin.ts
 * La build: lista bibliotecilor din aplicație (dependențele de producție, cu ale lor), cu
 * licența și textul ei, în `licenses-deps.json`. MIT, Apache și BSD cer ca nota de copyright
 * și licența să meargă odată cu aplicația; ecranul „Licențe” din Setări o citește de aici.
 * Generată la fiecare build, ca lista să nu rămână în urmă.
 */
export interface DepLicense { name: string; version: string; license: string; text?: string }

function readJson(p: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function findPkgDir(name: string, from: string): string | null {
  let dir = from;
  for (;;) {
    const cand = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(cand, 'package.json'))) return cand;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function collectLicenses(root: string): DepLicense[] {
  const rootPkg = readJson(path.join(root, 'package.json')) ?? {};
  const seen = new Map<string, DepLicense>();
  const queue: { name: string; from: string }[] = Object.keys((rootPkg.dependencies as Record<string, string>) ?? {}).map(name => ({ name, from: root }));
  while (queue.length) {
    const { name, from } = queue.shift()!;
    const dir = findPkgDir(name, from);
    if (!dir) continue;
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg) continue;
    const key = `${name}@${pkg.version}`;
    if (seen.has(key)) continue;
    const lic = typeof pkg.license === 'string' ? pkg.license : (pkg.license as { type?: string } | undefined)?.type ?? 'UNKNOWN';
    const file = fs.readdirSync(dir).find(f => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(f));
    let text: string | undefined;
    if (file) { try { text = fs.readFileSync(path.join(dir, file), 'utf8').slice(0, 12000); } catch { /* fără text */ } }
    seen.set(key, { name, version: String(pkg.version ?? ''), license: lic, text });
    for (const dep of Object.keys((pkg.dependencies as Record<string, string>) ?? {})) queue.push({ name: dep, from: dir });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function licensesPlugin(): Plugin {
  return {
    name: 'cherrypic-licenses',
    apply: 'build',
    generateBundle() {
      const list = collectLicenses(process.cwd());
      this.emitFile({ type: 'asset', fileName: 'licenses-deps.json', source: JSON.stringify(list) });
    }
  };
}
