import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MetricBar, sharpnessTone, eyesTone } from './MetricBar';
import { DEFECT_SHARPNESS, DEFECT_EYES_OPEN_RATIO } from '../core/importPipeline';

/**
 * ui/MetricBar.test.tsx
 * Culoarea unei bare e o AFIRMATIE: "asta a contat la scor". Deci singurul
 * lucru care conteaza cu adevarat aici e ca pragul de colorare sa fie ACELASI
 * cu cel la care motorul numara un defect. Testele leaga cele doua explicit,
 * prin constantele importate — daca cineva schimba pragul motorului si uita
 * culoarea, pica aici, nu pe telefonul unui utilizator.
 */
describe('pragurile de culoare urmeaza motorul, nu o parere', () => {
  it('claritatea devine rosie exact sub pragul de defect al motorului', () => {
    expect(sharpnessTone(DEFECT_SHARPNESS)).toBe('good');
    expect(sharpnessTone(DEFECT_SHARPNESS - 0.01)).toBe('bad');
    expect(sharpnessTone(0)).toBe('bad');
    expect(sharpnessTone(100)).toBe('good');
  });

  it('ochii devin rosii exact sub pragul de defect al motorului', () => {
    expect(eyesTone(DEFECT_EYES_OPEN_RATIO)).toBe('good');
    expect(eyesTone(DEFECT_EYES_OPEN_RATIO - 0.001)).toBe('bad');
    expect(eyesTone(1)).toBe('good');
    expect(eyesTone(0)).toBe('bad');
  });
});

describe('MetricBar', () => {
  it('scrie procentul o singura data si il foloseste si pentru latimea barei', () => {
    // Inainte, fiecare rand calcula fractiunea de doua ori, separat pentru bara
    // si pentru eticheta — doua locuri care puteau ajunge sa nu mai fie de acord.
    const { container } = render(<MetricBar icon={null} label="Claritate" percent={88.4} />);
    expect(container.textContent).toContain('88%');
    expect((container.querySelector('i > b') as HTMLElement).style.width).toBe('88%');
  });

  it('plafoneaza valorile din afara scalei in loc sa deseneze o bara peste caseta', () => {
    const peste = render(<MetricBar icon={null} label="x" percent={140} />).container;
    expect((peste.querySelector('i > b') as HTMLElement).style.width).toBe('100%');
    const sub = render(<MetricBar icon={null} label="x" percent={-20} />).container;
    expect((sub.querySelector('i > b') as HTMLElement).style.width).toBe('0%');
  });

  it('fara ton explicit ramane neutru — exact aspectul de dinainte', () => {
    const { container } = render(<MetricBar icon={null} label="Zâmbet" percent={60} />);
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'neutral');
  });

  it('bara nu se anunta separat la cititorul de ecran — procentul o spune deja', () => {
    const { container } = render(<MetricBar icon={null} label="Claritate" percent={88} tone="good" />);
    expect(container.querySelector('i')).toHaveAttribute('aria-hidden', 'true');
  });
});
