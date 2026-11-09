/** R-7 linear quantiles. Unreached observations sort above finite values; never drop them. */
export function distribution(values: readonly (number | null)[]) {
  if (values.some(value => value !== null && !Number.isFinite(value))) throw new Error('Distribution requires finite values or censored nulls');
  const sorted = [...values].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
  const quantile = (fraction: number): number | null => {
    if (sorted.length === 0) return null;
    const position = (sorted.length - 1) * fraction;
    const lower = sorted[Math.floor(position)], upper = sorted[Math.ceil(position)];
    if (lower === undefined || upper === undefined || lower === null || upper === null) return null;
    return lower + (upper - lower) * (position - Math.floor(position));
  };
  return { count: values.length, observed: values.filter(value => value !== null).length,
    censored: values.filter(value => value === null).length, p10: quantile(0.1), median: quantile(0.5), p90: quantile(0.9) };
}
