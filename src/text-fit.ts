/** Return a measured prefix plus one Unicode ellipsis, bounded by the available pixel width. */
export function ellipsize(text: string, maxWidth: number, measure: (value: string) => number): string {
  if (!(maxWidth > 0)) return '';
  if (measure(text) <= maxWidth) return text;
  const suffix = '…';
  if (measure(suffix) > maxWidth) return '';
  const points = Array.from(text);
  let low = 0, high = points.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${points.slice(0, mid).join('')}${suffix}`) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${points.slice(0, low).join('')}${suffix}`;
}
