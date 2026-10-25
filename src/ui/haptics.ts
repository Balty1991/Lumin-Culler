/** Vibration API — suportata pe Android (Chrome/Brave), absenta pe iOS Safari.
    No-op sigur peste tot altundeva (Tauri/Electron mostenesc suportul webview-ului). */
export function vibrate(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* API optionala, ignoram */ }
}
