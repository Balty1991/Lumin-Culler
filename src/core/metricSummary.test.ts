import { describe, expect, it } from 'vitest';
import { technicalSummary, subjectSummary, framingSummary } from './metricSummary';

describe('rezumatul grupei tehnice', () => {
  const bun = { faceCount: 1, sharpness: 80, exposure: 50 };

  it('raporteaza CEL MAI RAU lucru, nu o medie', () => {
    // expunere perfecta + complet miscata nu inseamna "pe la mijloc"
    expect(technicalSummary({ ...bun, exposure: 50 }, 20).key).toBe('metrics.summary.technical.soft');
  });

  it('numeste defectul potrivit', () => {
    expect(technicalSummary({ ...bun, exposure: 25 }, 80).key).toBe('metrics.summary.technical.under');
    expect(technicalSummary({ ...bun, exposure: 80 }, 80).key).toBe('metrics.summary.technical.over');
    expect(technicalSummary({ ...bun, highlightClipping: 0.2 }, 80).key).toBe('metrics.summary.technical.highlights');
    expect(technicalSummary({ ...bun, shadowClipping: 0.2 }, 80).key).toBe('metrics.summary.technical.shadows');
  });

  it('cand nu e nimic in neregula, nu sperie pe nimeni', () => {
    expect(technicalSummary(bun, 85)).toEqual({ key: 'metrics.summary.technical.clean', tone: 'ok' });
    expect(technicalSummary(bun, 55)).toEqual({ key: 'metrics.summary.technical.fine', tone: 'ok' });
  });

  it('claritatea vine din afara — un peisaj nu se judeca cu rigla portretului', () => {
    // acelasi obiect, doua clarități efective, doua verdicte
    expect(technicalSummary(bun, 20).tone).toBe('warn');
    expect(technicalSummary(bun, 75).tone).toBe('ok');
  });
});

describe('rezumatul grupei de subiect', () => {
  it('ochii inchisi trec inaintea zambetului — nu se repara nicicum', () => {
    const r = subjectSummary({ faceCount: 1, allEyesOpen: false, bestSmile: 0.9 });
    expect(r).toEqual({ key: 'metrics.summary.subject.blink', tone: 'warn' });
  });

  it('la grup spune ca cineva clipeste, nu ca toti', () => {
    expect(subjectSummary({ faceCount: 4, allEyesOpen: true, groupEyesOpenRatio: 0.75, bestSmile: 0.8 }).key)
      .toBe('metrics.summary.subject.someBlink');
  });

  it('cand e bine, spune ce e bine', () => {
    expect(subjectSummary({ faceCount: 1, allEyesOpen: true, bestSmile: 0.8 }).key).toBe('metrics.summary.subject.smiling');
    expect(subjectSummary({ faceCount: 1, allEyesOpen: true, bestSmile: 0.1 }).key).toBe('metrics.summary.subject.eyesOpen');
  });

  it('la grup foloseste fractiunea care zambesc, nu cel mai larg zambet', () => {
    // un singur zambet mare nu poate ascunde un grup serios
    expect(subjectSummary({ faceCount: 5, allEyesOpen: true, groupEyesOpenRatio: 1, bestSmile: 0.95, groupSmileRatio: 0.2 }).key)
      .toBe('metrics.summary.subject.eyesOpen');
  });
});

describe('rezumatul incadrarii', () => {
  it('pe poze cu oameni judeca spatiul deasupra capului si treimile', () => {
    expect(framingSummary({ faceCount: 1, headroom: 0.1, ruleOfThirds: 0.8 }).key).toBe('metrics.summary.framing.headroom');
    expect(framingSummary({ faceCount: 1, headroom: 0.8, ruleOfThirds: 0.1 }).key).toBe('metrics.summary.framing.centered');
    expect(framingSummary({ faceCount: 1, headroom: 0.8, ruleOfThirds: 0.8 }).key).toBe('metrics.summary.framing.strong');
  });

  it('fara oameni in cadru nu exista "headroom" — se judeca altfel', () => {
    expect(framingSummary({ faceCount: 0, leadingLinesDetected: true }).key).toBe('metrics.summary.framing.structure');
    expect(framingSummary({ faceCount: 0, negativeSpaceScore: 0.1 }).key).toBe('metrics.summary.framing.crowded');
  });

  it('datele lipsa nu produc o alarma falsa', () => {
    expect(framingSummary({ faceCount: 1 }).tone).toBe('ok');
    expect(framingSummary({ faceCount: 0 }).tone).toBe('ok');
  });
});
