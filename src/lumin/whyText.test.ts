import { describe, expect, it } from 'vitest';
import { explainWhy, type WhySignals } from './whyText';
import { ro } from '../i18n/ro';
import { en } from '../i18n/en';

const trOf = (dict: Record<string, string>) => (k: string, v: Record<string, string | number> = {}) =>
  String(dict[k] ?? `!${k}!`).replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ''));
const tr = trOf(ro as Record<string, string>);
const base: WhySignals = {
  status: 'selected', aiDecided: true, aiScore: 85, personNames: [],
  sharpness: 80, exposure: 50, faceCount: 1, allEyesOpen: true, bestSmile: 0.8
};
const none = { loved: [] };

describe('explainWhy', () => {
  it('păstrată de AI: zâmbește, are ochii deschiși și seamănă cu pozele tale', () => {
    const r = explainWhy({ ...base, sharpness: 60, tasteP: 0.9 }, none, tr);
    expect(r.sentence).toBe('Am păstrat-o: seamănă cu pozele pe care le păstrezi tu, zâmbește și are ochii deschiși.');
    expect(r.chips.map(c => c.label)).toEqual(['gustul tău', 'zâmbet', 'ochi deschiși']);
    expect(r.keep).toBe(true);
  });

  it('motivele personale vin primele: omul la care ții, apoi gustul', () => {
    const r = explainWhy({ ...base, personNames: ['Angi'], tasteP: 0.8 }, { loved: [{ name: 'Angi', rate: 0.9 }] }, tr);
    expect(r.sentence).toMatch(/^Am păstrat-o: e Angi — păstrezi 9 din 10 poze cu Angi, seamănă cu pozele pe care le păstrezi tu și zâmbește\.$/);
    expect(r.chips[0]).toEqual({ label: 'Angi', tone: 'good' });
    expect(r.chips).toHaveLength(3);
  });

  it('pusă la Nu păstrez de AI: o dublură mai slabă, cu una mai clară', () => {
    const r = explainWhy({ ...base, status: 'rejected', aiScore: 40, sharpness: 50, bestSmile: 0 }, { loved: [], betterTwin: { sharper: true } }, tr);
    expect(r.sentence).toBe('Am pus-o la Nu păstrez: e aproape la fel cu una mai clară din aceeași serie.');
    expect(r.chips).toEqual([{ label: 'una mai bună în serie', tone: 'bad' }]);
  });

  it('nu spune „mai clară” dacă celălalt cadru nu e mai clar', () => {
    const r = explainWhy({ ...base, status: 'rejected', aiScore: 40, bestSmile: 0 }, { loved: [], betterTwin: { sharper: false } }, tr);
    expect(r.sentence).toContain('una mai reușită din aceeași serie');
    expect(r.sentence).not.toContain('mai clară');
  });

  it('decizia omului e spusă ca a lui', () => {
    expect(explainWhy({ ...base, aiDecided: false }, none, tr).sentence).toMatch(/^Ai păstrat-o:/);
    expect(explainWhy({ ...base, aiDecided: undefined, status: 'rejected', sharpness: 20 }, none, tr).sentence).toMatch(/^Ai pus-o la Nu păstrez: e mișcată/);
  });

  it('încă nehotărâtă: spune ce crede, nu ce a făcut', () => {
    expect(explainWhy({ ...base, status: 'pending' }, none, tr).sentence).toMatch(/^Cred că ai păstra-o:/);
    expect(explainWhy({ ...base, status: 'pending', aiScore: 30, sharpness: 20, bestSmile: 0 }, none, tr).sentence).toMatch(/^Cred că n-ai păstra-o: e mișcată/);
    // Cadrul mai bun arătat pe ecran schimbă verdictul (nu se contrazic).
    expect(explainWhy({ ...base, status: 'pending' }, { loved: [], betterTwin: { sharper: false } }, tr).keep).toBe(false);
  });

  it('gustul tău nu e invocat fără model sau la valori nesigure', () => {
    expect(explainWhy(base, none, tr).sentence).not.toContain('pozele pe care le păstrezi');
    expect(explainWhy({ ...base, tasteP: 0.55 }, none, tr).sentence).not.toContain('pozele pe care le păstrezi');
    // Gustul împotriva verdictului nu e folosit ca argument.
    expect(explainWhy({ ...base, tasteP: 0.1 }, none, tr).sentence).not.toContain('nu seamănă');
    const drop = explainWhy({ ...base, status: 'rejected', tasteP: 0.1, bestSmile: 0, faceCount: 0 }, none, tr);
    expect(drop.sentence).toContain('nu seamănă cu pozele pe care le păstrezi de obicei');
  });

  it('nu pretinde zâmbet sau ochi deschiși fără fețe', () => {
    const r = explainWhy({ ...base, faceCount: 0, bestSmile: 0, allEyesOpen: false }, none, tr);
    expect(r.sentence).not.toMatch(/zâmb|ochi/);
    expect(r.sentence).toBe('Am păstrat-o: e clară.');
  });

  it('subiect clar pe fundal estompat nu e „mișcată”', () => {
    const r = explainWhy({ ...base, sharpness: 25, subjectInFocus: true, bestSmile: 0 }, none, tr);
    expect(r.sentence).toContain('subiectul e clar');
    expect(r.sentence).not.toContain('mișcată');
  });

  it('spune și cusurul unei poze păstrate', () => {
    const r = explainWhy({ ...base, sharpness: 20 }, none, tr);
    expect(r.sentence).toMatch(/, deși e mișcată\.$/);
    expect(r.chips.some(c => c.tone === 'bad' && c.label === 'mișcată')).toBe(true);
  });

  it('documentele și capturile sunt puse deoparte, cu motivul lor', () => {
    const r = explainWhy({ ...base, aside: 'screenshot', status: 'review' }, none, tr);
    expect(r.sentence).toBe('Am pus-o deoparte: e o captură de ecran, nu o amintire.');
    expect(r.chips).toEqual([{ label: 'captură de ecran', tone: 'info' }]);
  });

  it('fără niciun semnal, o propoziție cinstită, fără etichete goale', () => {
    const r = explainWhy({ ...base, status: 'rejected', faceCount: 0, bestSmile: 0, sharpness: 55 }, none, tr);
    expect(r.sentence).toBe('Am pus-o la Nu păstrez: nu iese în evidență printre pozele pe care le păstrezi.');
    expect(r.chips).toEqual([]);
  });

  it('are text în engleză pentru toate cheile folosite', () => {
    const r = explainWhy({ ...base, tasteP: 0.9, personNames: ['Angi'] }, { loved: [], bestOfSeries: true }, trOf(en as Record<string, string>));
    expect(r.sentence).not.toContain('!');
    expect(r.sentence).toMatch(/^I kept it: /);
  });
});
