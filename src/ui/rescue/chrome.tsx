import { rescueT, type RescueKey, type RescueLocale } from '../../rescue/copy';

export function Brand() {
  return <p className="rescue-brand">Lumin</p>;
}

export function SizeHeading({ locale, template, size }: { locale: RescueLocale; template: RescueKey; size: string }) {
  const text = rescueT(locale, template, { size });
  const at = text.indexOf(size);
  if (at < 0) return <h1>{text}</h1>;
  return (
    <h1>
      {text.slice(0, at)}
      <span className="rescue-display">{size}</span>
      {text.slice(at + size.length)}
    </h1>
  );
}

export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="rescue-back" onClick={onClick}>{label}</button>
  );
}
