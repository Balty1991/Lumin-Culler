/**
 * lumin/folderClean.ts
 * Curățenia pe dosare: pozele primite (WhatsApp, Telegram, descărcări, capturi)
 * ocupă de obicei cel mai mult. Pentru fiecare dosar al galeriei: câte poze are,
 * câte a citit Cherrypic și câte se pot scoate (tot ce nu e păstrat). Logică pură.
 */
import type { PhotoView } from '../state/store';

export interface FolderInfo { id: string; name: string; count: number; uris: string[] }
export interface FolderSummary { id: string; name: string; inGallery: number; read: number; removable: PhotoView[]; bytes: number; received: boolean }

/** Dosarele unde ajung poze primite sau salvate, nu făcute de om cu camera. */
const RECEIVED = /whatsapp|telegram|messenger|signal|viber|download|descărc|descarc|screenshot|captur|instagram|facebook|tiktok|snapchat|bluetooth|twitter|reddit|pinterest/i;
const CAMERA = /^(camera|dcim|100andro|100media)$/i;

export function summarizeFolders(folders: readonly FolderInfo[], photos: readonly PhotoView[]): FolderSummary[] {
  const byUri = new Map<string, PhotoView>();
  for (const p of photos) if (p.mediaUri) byUri.set(p.mediaUri, p);
  const out: FolderSummary[] = [];
  for (const f of folders) {
    if (CAMERA.test(f.name.trim())) continue;
    const known = f.uris.map(u => byUri.get(u)).filter((p): p is PhotoView => !!p);
    // Ce se poate scoate: tot ce nu e păstrat și n-are oameni în ea. Cerut: „la WhatsApp,
    // curățenie doar la capturi; pozele cu persoane le păstrează” — și cele cu oameni
    // nenumiți (familia primită de la alții), nu doar cu cei pe care i-ai numit.
    const removable = known.filter(p => p.status !== 'selected' && !(p.personNames?.length) && !(p.faceCount > 0));
    out.push({
      id: f.id, name: f.name, inGallery: f.count, read: known.length, removable,
      bytes: removable.reduce((s, p) => s + (p.sizeBytes ?? 0), 0), received: RECEIVED.test(f.name)
    });
  }
  // Întâi dosarele cu poze primite, apoi după cât eliberează și cât de mari sunt.
  return out.filter(f => f.inGallery >= 5)
    .sort((a, b) => Number(b.received) - Number(a.received) || b.bytes - a.bytes || b.inGallery - a.inGallery);
}
