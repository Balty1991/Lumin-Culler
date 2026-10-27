/**
 * state/tasteQuiz.ts
 * A făcut omul testul „Învață-mă”? Ținut local, ca bun-venitul
 * (state/welcomeOnboarding.ts). Și evenimentul care îl deschide de oriunde.
 */
const STORAGE_KEY = 'lumin-taste-quiz-done';

export const TASTE_QUIZ_OPEN_EVENT = 'lumin-open-taste-quiz';

export function readTasteQuizDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeTasteQuizDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // stocare indisponibilă: testul poate reveni la următoarea deschidere
  }
}

export function openTasteQuiz(): void {
  window.dispatchEvent(new Event(TASTE_QUIZ_OPEN_EVENT));
}
