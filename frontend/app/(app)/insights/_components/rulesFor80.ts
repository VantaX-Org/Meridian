/** How many of the top rules (by impact) it takes to reach 80 % of the listed impact. */
export function rulesFor80(impacts: number[]): number {
  const sorted = [...impacts].sort((a, b) => b - a);
  let total = 0;
  for (const n of sorted) total += n;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run += sorted[i];
    if (total > 0 && run / total >= 0.8) return i + 1;
  }
  return sorted.length;
}
