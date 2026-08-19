/**
 * ui/PremiumProof.tsx
 * Miniaturi care ARATA rezultatul fiecarui beneficiu Premium, in locul unei
 * iconite generice.
 *
 * De ce exista: panoul enumera sapte lucruri in cuvinte ("predare catre
 * Lightroom (XMP)", "plansa de contact"), iar cine nu a folosit deja functia nu
 * are de unde sti ce primeste. O miniatura a fisierului XMP, a galeriei
 * trimise clientului sau a plansei de contact spune in mai putin de o secunda
 * exact ce cuvintele descriu in doua randuri.
 *
 * Desenate inline, ca SVG: zero octeti de descarcat, se scaleaza fara sa se
 * incetoseze si urmeaza tokenii temei, deci nu trebuie tinute doua seturi
 * pentru tema intunecata si cea luminoasa (exact capcana in care a cazut
 * stratul de concept portat — vezi styles.concept.css).
 *
 * aria-hidden peste tot: fiecare miniatura sta LANGA titlul si descrierea
 * beneficiului, care spun deja acelasi lucru in cuvinte. Anuntate separat, ar
 * repeta informatia pentru cine foloseste un cititor de ecran.
 */

/** Rama comuna — aceleasi proportii si acelasi contur pentru toate sase, ca sa se citeasca drept un set. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg className="premium-proof" viewBox="0 0 152 86" role="presentation" aria-hidden="true">
      <rect x=".5" y=".5" width="151" height="85" rx="11" className="pp-bg" />
      {children}
    </svg>
  );
}

/** Export fara plafon: pozele ies din biblioteca, iar contorul nu se mai opreste la o cifra. */
function ExportProof() {
  return (
    <Frame>
      {[0, 1, 2].map(i => (
        <rect key={i} x={14 + i * 22} y="20" width="18" height="18" rx="3" className="pp-solid" />
      ))}
      <path d="M86 29h34m-8-6 8 6-8 6" className="pp-accent-stroke" />
      <rect x="14" y="52" width="106" height="6" rx="3" className="pp-track" />
      <rect x="14" y="52" width="106" height="6" rx="3" className="pp-accent-fill" />
      <text x="126" y="58" className="pp-label pp-accent-text">∞</text>
    </Frame>
  );
}

/** Persoane recunoscute: fete cu nume, si loc pentru inca una. */
function PersonsProof() {
  return (
    <Frame>
      {[0, 1].map(i => (
        <g key={i}>
          <circle cx={30 + i * 46} cy="34" r="13" className="pp-solid" />
          <circle cx={30 + i * 46} cy="30" r="4.5" className="pp-faint-fill" />
          <path d={`M${21 + i * 46} 45a9 9 0 0 1 18 0`} className="pp-faint-fill" />
          <rect x={14 + i * 46} y="56" width="32" height="9" rx="4.5" className="pp-chip" />
        </g>
      ))}
      <circle cx="122" cy="34" r="13" className="pp-accent-dash" />
      <path d="M122 28v12m-6-6h12" className="pp-accent-stroke" />
    </Frame>
  );
}

/** Fluxul profesional: fisierul XMP pe care il citeste Lightroom, cu stele si eticheta de culoare. */
function ProProof() {
  return (
    <Frame>
      <rect x="14" y="14" width="58" height="58" rx="5" className="pp-solid" />
      <path d="M14 56l16-14 12 10 10-8 20 16v8a5 5 0 0 1-5 5H19a5 5 0 0 1-5-5z" className="pp-faint-fill" />
      <circle cx="34" cy="30" r="5" className="pp-faint-fill" />
      <rect x="84" y="18" width="54" height="22" rx="4" className="pp-chip" />
      <text x="90" y="33" className="pp-label pp-accent-text">.xmp</text>
      {[0, 1, 2, 3].map(i => (
        <path key={i} d={`M${88 + i * 12} 54l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z`} className="pp-accent-fill" />
      ))}
      <rect x="84" y="46" width="0" height="0" />
      <circle cx="134" cy="58" r="5" className="pp-review-fill" />
    </Frame>
  );
}

/** Partea de aratat altora: recapul si prezentarea, ca un cadru care ruleaza. */
function ShowProof() {
  return (
    <Frame>
      <rect x="14" y="14" width="124" height="46" rx="5" className="pp-solid" />
      <path d="M66 28l18 9-18 9z" className="pp-accent-fill" />
      <rect x="14" y="68" width="124" height="5" rx="2.5" className="pp-track" />
      <rect x="14" y="68" width="52" height="5" rx="2.5" className="pp-accent-fill" />
    </Frame>
  );
}

/** Locatii: pozele grupate sub numele localitatii si al tarii. */
function LocationsProof() {
  return (
    <Frame>
      <path d="M18 26h116M18 44h116M18 62h116M44 14v58M84 14v58M114 14v58" className="pp-grid" />
      <path d="M70 24a11 11 0 0 1 22 0c0 8-11 19-11 19S70 32 70 24z" className="pp-accent-fill" />
      <circle cx="81" cy="24" r="4" className="pp-bg-fill" />
      <rect x="30" y="56" width="92" height="14" rx="7" className="pp-chip" />
      <text x="38" y="66" className="pp-label">Roșiori · România</text>
    </Frame>
  );
}

/** Combinarea a doua cadre: doua incercari, un rezultat. */
function CompositeProof() {
  return (
    <Frame>
      <rect x="12" y="24" width="38" height="38" rx="4" className="pp-solid" />
      <rect x="12" y="24" width="38" height="38" rx="4" className="pp-faint-stroke" />
      <rect x="57" y="24" width="38" height="38" rx="4" className="pp-solid" />
      <path d="M100 43h12m-5-5 5 5-5 5" className="pp-accent-stroke" />
      <rect x="116" y="24" width="24" height="38" rx="4" className="pp-accent-dash" />
      <path d="M128 34l2.4 5.6 5.6 2.4-5.6 2.4-2.4 5.6-2.4-5.6-5.6-2.4 5.6-2.4z" className="pp-accent-fill" />
    </Frame>
  );
}

const PROOFS = {
  export: ExportProof,
  persons: PersonsProof,
  pro: ProProof,
  show: ShowProof,
  locations: LocationsProof,
  composite: CompositeProof,
} as const;

export type PremiumProofKind = keyof typeof PROOFS;

export function PremiumProof({ kind }: { kind: PremiumProofKind }) {
  const Proof = PROOFS[kind];
  return <Proof />;
}
