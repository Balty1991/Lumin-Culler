/**
 * lumin/Orb.tsx
 * „Prezența” AI-ului: o sferă care respiră. Starea se vede din mișcare:
 * liniștit (idle), lucrează (think: inele care se rotesc), învață (learn:
 * pulsul violet). Doar CSS, fără canvas.
 */
export type OrbMood = 'idle' | 'think' | 'learn';

export function Orb({ mood = 'idle', size = 120, label }: { mood?: OrbMood; size?: number; label?: string }) {
  return (
    <div className={`lx-orb lx-orb-${mood}`} style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <span className="lx-orb-ring r1" />
      <span className="lx-orb-ring r2" />
      <span className="lx-orb-ring r3" />
      <span className="lx-orb-core" />
    </div>
  );
}
