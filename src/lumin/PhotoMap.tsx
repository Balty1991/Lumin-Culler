import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { hasRealGps } from '../core/gpsCoordinates';
import { getCachedThumbUrl } from '../core/thumbUrlCache';
import { useLxPhotos } from './useLxPhotos';
import { useLx } from './lxStore';
import { useTr } from './context';
import type { PhotoView } from '../state/store';

/**
 * lumin/PhotoMap.tsx
 * „Hartă”: pozele puse pe locul unde au fost făcute, grupate după cât de
 * aproape sunt pe ecran. Atingi un grup: se apropie harta; când nu mai are
 * unde, se deschid pozele.
 *
 * Harta e online (cerința omului: „Harta fă-o online”): dalele vin de la
 * OpenFreeMap (date OpenStreetMap, fără cont, folosire comercială permisă).
 * Serverul de hărți vede doar zona privită, ca orice hartă; pozele și
 * coordonatele lor nu pleacă din telefon — punctele se desenează aici.
 */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
/** Cât de aproape (pixeli pe ecran) ajung două poze în același grup. */
const CELL_PX = 68;
const MAX_ZOOM = 17;

type GeoPhoto = PhotoView & { gpsLatitude: number; gpsLongitude: number };

interface Cluster { photos: GeoPhoto[]; lng: number; lat: number }

export function PhotoMap() {
  const photos = useLxPhotos();
  const openViewer = useLx(s => s.openViewer);
  const tr = useTr();
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [failed, setFailed] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);

  const geo = useMemo(
    () => photos.filter((p): p is GeoPhoto => hasRealGps(p.gpsLatitude, p.gpsLongitude) && !p.aside),
    [photos]
  );
  const without = photos.length - geo.length;

  // Ultimele valori, citite din evenimentele hărții (montată o singură dată).
  const latest = useRef({ geo, openViewer });
  latest.current = { geo, openViewer };

  useEffect(() => {
    const el = box.current;
    if (!el || failed || geo.length === 0) return;
    const m = new maplibregl.Map({
      container: el,
      style: STYLE_URL,
      bounds: boundsOf(geo),
      fitBoundsOptions: { padding: 48, maxZoom: 13 },
      maxZoom: MAX_ZOOM,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false
    });
    m.touchZoomRotate.disableRotation();
    map.current = m;

    let markers: maplibregl.Marker[] = [];
    const draw = () => {
      for (const mk of markers) mk.remove();
      markers = [];
      const { geo: list, openViewer: open } = latest.current;
      for (const c of clusterOnScreen(m, list)) {
        const node = markerNode(c, tr('lx.map.photos', { count: c.photos.length }));
        node.addEventListener('click', ev => {
          ev.stopPropagation();
          const zoom = m.getZoom();
          const spread = boundsOf(c.photos);
          const tiny = spread.getNorthEast().distanceTo(spread.getSouthWest()) < 30;
          if (c.photos.length > 1 && zoom < MAX_ZOOM - 0.5 && !tiny) {
            m.fitBounds(spread, { padding: 80, maxZoom: Math.min(MAX_ZOOM, zoom + 4) });
          } else {
            const ids = [...c.photos].sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0)).map(p => p.id);
            open(ids, 0);
          }
        });
        markers.push(new maplibregl.Marker({ element: node }).setLngLat([c.lng, c.lat]).addTo(m));
      }
    };
    m.on('load', draw);
    m.on('moveend', draw);
    m.on('error', ev => {
      // Fără internet stilul nu se încarcă deloc; o dală lipsă, mai târziu, nu e o problemă.
      if (!m.isStyleLoaded() && !m.loaded()) setFailed(true);
      void ev;
    });
    return () => {
      for (const mk of markers) mk.remove();
      m.remove();
      map.current = null;
    };
    // Harta se face o dată; pozele noi se văd la următoarea mișcare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed, geo.length === 0]);

  // Pozele s-au schimbat (import, ștergere): redesenăm grupurile pe loc.
  useEffect(() => {
    const m = map.current;
    if (m?.loaded()) m.fire('moveend');
  }, [geo]);

  if (geo.length === 0) {
    return <p className="lx-empty">{tr('lx.map.empty')}</p>;
  }

  return (
    <div className="lx-map-wrap">
      <p className="lx-map-note">
        {tr('lx.map.count', { count: geo.length })}
        {without > 0 && <> · {tr('lx.map.without', { count: without })}</>}
      </p>
      {failed ? (
        <div className="lx-map lx-map-off">
          <p>{tr('lx.map.offline')}</p>
          <button className="lx-btn ghost small" onClick={() => setFailed(false)}>{tr('lx.map.retry')}</button>
        </div>
      ) : (
        <div ref={box} className="lx-map" />
      )}
      <p className="lx-map-privacy">{tr('lx.map.privacy')}</p>
    </div>
  );
}

function boundsOf(list: GeoPhoto[]): maplibregl.LngLatBounds {
  const b = new maplibregl.LngLatBounds();
  for (const p of list) b.extend([p.gpsLongitude, p.gpsLatitude]);
  return b;
}

/** Grupează pozele vizibile pe celule de ecran; fiecare grup arată poza cea mai bună. */
function clusterOnScreen(m: maplibregl.Map, list: GeoPhoto[]): Cluster[] {
  const view = m.getBounds();
  const cells = new Map<string, GeoPhoto[]>();
  for (const p of list) {
    if (!view.contains([p.gpsLongitude, p.gpsLatitude])) continue;
    const pt = m.project([p.gpsLongitude, p.gpsLatitude]);
    const key = `${Math.floor(pt.x / CELL_PX)}:${Math.floor(pt.y / CELL_PX)}`;
    const cell = cells.get(key);
    if (cell) cell.push(p); else cells.set(key, [p]);
  }
  return [...cells.values()].map(group => {
    group.sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0));
    const lng = group.reduce((s, p) => s + p.gpsLongitude, 0) / group.length;
    const lat = group.reduce((s, p) => s + p.gpsLatitude, 0) / group.length;
    return { photos: group, lng, lat };
  });
}

function markerNode(c: Cluster, label: string): HTMLElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'lx-map-pin';
  node.setAttribute('aria-label', label);
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  node.appendChild(img);
  void getCachedThumbUrl(c.photos[0].id).then(url => { if (url) img.src = url; }).catch(() => {});
  if (c.photos.length > 1) {
    const n = document.createElement('span');
    n.textContent = c.photos.length > 999 ? '999+' : String(c.photos.length);
    node.appendChild(n);
  }
  return node;
}
