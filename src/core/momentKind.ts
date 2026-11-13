/**
 * core/momentKind.ts
 */
/**
 * Un moment de păstrat, nu doar o poză reușită tehnic (cerut: „momente frumoase” respinse):
 * sărbătoare (tort, lumânări, baloane, cadouri), joacă, îmbrățișare, râs, sau mai mulți oameni
 * care zâmbesc. Asemenea poze nu sunt scoase de AI pe scor și primesc o marjă mai largă.
 */
const MOMENT_TAG = /^(cake|birthday cake|candle|birthday|party|balloon|gift|present|christmas|christmas tree|celebration|wedding|bride|hug|kiss|toy|stuffed toy|teddy bear|playground|swing|slide|carousel|play|fun|dance|dancing|game|bubble|snowman|laughing|confetti|fireworks|costume)$/i;
export const MOMENT_MARGIN = 22;
export function isMoment(a: { faceCount?: number; sceneTags?: readonly string[]; bestSmile?: number; joy?: number }): boolean {
  if ((a.faceCount ?? 0) <= 0) return false;
  if ((a.sceneTags ?? []).some(t => MOMENT_TAG.test(t))) return true;
  if ((a.joy ?? 0) >= 0.85 || (a.bestSmile ?? 0) >= 0.85) return true;
  return (a.faceCount ?? 0) >= 2 && (a.bestSmile ?? 0) >= 0.6;
}

