import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetAnalysisTiming, recordAnalysisTiming, analysisTimingSnapshot, timedModel
} from './analysisTiming';

beforeEach(() => resetAnalysisTiming());

describe('analysisTiming', () => {
  it('nu raporteaza nimic cand n-a masurat nimic — pe web nu exista modele native', () => {
    expect(analysisTimingSnapshot()).toBeUndefined();
  });

  it('aduna apelurile aceluiasi model pe tot lotul', () => {
    recordAnalysisTiming('FaceMesh', 10);
    recordAnalysisTiming('FaceMesh', 15);
    recordAnalysisTiming('FaceDetection', 4);
    expect(analysisTimingSnapshot()).toEqual({ FaceMesh: 25, FaceDetection: 4 });
  });

  it('fiecare lot porneste de la zero — altfel ar fi suma de la deschiderea aplicatiei', () => {
    recordAnalysisTiming('FaceMesh', 10);
    resetAnalysisTiming();
    expect(analysisTimingSnapshot()).toBeUndefined();
  });

  // Un model care arunca dupa cinci secunde a consumat cinci secunde. Netinut in
  // socoteala, tocmai cazul cel mai scump ar fi cel invizibil.
  it('numara si apelurile care esueaza, si lasa eroarea sa treaca mai departe', async () => {
    await expect(
      timedModel('PoseDetection', () => Promise.reject(new Error('crapat')))
    ).rejects.toThrow('crapat');
    expect(Object.keys(analysisTimingSnapshot() ?? {})).toEqual(['PoseDetection']);
  });

  it('intoarce valoarea apelului cronometrat, neatinsa', async () => {
    await expect(timedModel('ImageLabeling', async () => ({ labels: ['dog'] })))
      .resolves.toEqual({ labels: ['dog'] });
  });
});
