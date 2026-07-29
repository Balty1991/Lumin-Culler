/** "YYYY-MM-DD" (valoarea unui <input type="date">, in fusul local) -> epoch ms, la inceputul/sfarsitul zilei. */
export function dateInputToEpoch(value: string, endOfDay: boolean): number | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** epoch ms -> "YYYY-MM-DD" in fusul local, pentru valoarea unui <input type="date">. */
export function epochToDateInput(epoch: number | null): string {
  if (epoch === null) return '';
  const d = new Date(epoch);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
