import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTr } from './context';
import { LICENSE_TEXT, LICENSE_URL, MODEL_CREDITS, NATIVE_CREDITS, type Credit, type LicenseId } from './credits';

/**
 * lumin/LicensesSheet.tsx
 * „Licențe”: modelele AI și bibliotecile folosite, cu autorii și textul licenței. Cerut de
 * licențele lor (MIT, Apache, BSD, CC BY): nota trebuie să meargă odată cu aplicația.
 */
interface Dep { name: string; version: string; license: string; text?: string }

/** Textele de licență sunt rupte la 80 de coloane; pe telefon, paragrafele curg normal. */
const reflow = (t: string) => t.replace(/\r/g, '').replace(/([^\n])\n(?!\n|\s*(?:\d+\.|[-*•(]))/g, '$1 ');

function CreditRow({ c, onText }: { c: Credit; onText: (l: LicenseId) => void }) {
  return (
    <li className="lx-lic-row">
      <b>{c.name}</b>
      <small>{c.author}</small>
      <span className="lx-lic-meta">
        {LICENSE_TEXT[c.license]
          ? <button className="lx-link" onClick={() => onText(c.license)}>{c.license}</button>
          : LICENSE_URL[c.license] ? <a className="lx-link" href={LICENSE_URL[c.license]} target="_blank" rel="noreferrer">{c.license}</a> : <span>{c.license}</span>}
        {' · '}<a className="lx-link" href={c.url} target="_blank" rel="noreferrer">{c.url.replace(/^https:\/\//, '')}</a>
      </span>
    </li>
  );
}

export function LicensesSheet({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const [deps, setDeps] = useState<Dep[] | null>(null);
  const [text, setText] = useState<{ title: string; body: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('./licenses-deps.json').then(r => (r.ok ? r.json() : [])).then((d: Dep[]) => { if (alive) setDeps(d); }).catch(() => { if (alive) setDeps([]); });
    return () => { alive = false; };
  }, []);
  const showLicense = (l: LicenseId) => {
    const url = LICENSE_TEXT[l];
    if (!url) return;
    void fetch(url).then(r => r.text()).then(body => setText({ title: l, body })).catch(() => undefined);
  };
  return createPortal(
    <div className="lx lx-lic" role="dialog" aria-modal="true" aria-label={tr('lx.lic.title')}>
      <header className="lx-cc-top">
        <button className="lx-icon-btn" onClick={text ? () => setText(null) : onClose} aria-label={tr('lx.close')}>{text ? '‹' : '✕'}</button>
        <b>{text ? text.title : tr('lx.lic.title')}</b>
        <span />
      </header>
      {text ? (
        <pre className="lx-lic-text">{reflow(text.body)}</pre>
      ) : (
        <div className="lx-lic-body">
          <p className="lx-hint">{tr('lx.lic.intro')}</p>
          <h3>{tr('lx.lic.models')}</h3>
          <ul>{MODEL_CREDITS.map(c => <CreditRow key={c.name} c={c} onText={showLicense} />)}</ul>
          <h3>{tr('lx.lic.native')}</h3>
          <ul>{NATIVE_CREDITS.map(c => <CreditRow key={c.name} c={c} onText={showLicense} />)}</ul>
          <h3>{tr('lx.lic.libs', { count: deps?.length ?? 0 })}</h3>
          {deps === null ? <p className="lx-hint">…</p> : (
            <ul>
              {deps.map(d => (
                <li key={`${d.name}@${d.version}`} className="lx-lic-row">
                  <b>{d.name} <small>{d.version}</small></b>
                  <span className="lx-lic-meta">
                    {d.text ? <button className="lx-link" onClick={() => setText({ title: `${d.name} · ${d.license}`, body: d.text! })}>{d.license}</button> : <span>{d.license}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
