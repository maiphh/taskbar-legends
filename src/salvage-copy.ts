// §19.4 toast and gold formatting for protected salvage.
export function formatSalvageGold(value: number): string {
  return value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e4 ? `${(value / 1e3).toFixed(1)}K` : value.toLocaleString('en-US');
}
function title(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
/** Toast for a `salvage` event. 40-character HUD limit with the fallbacks in design.md §19.4. */
export function salvageToast(data: { rarity: string; slot: string; gold: number; reason: 'overflow' | 'incoming' }): string {
  const name = `${title(data.rarity)} ${title(data.slot)}`;
  if (data.reason === 'incoming') {
    const long = `Bag full: new ${name} salvaged`;
    return long.length <= 40 ? long : 'New item salvaged';
  }
  const gold = formatSalvageGold(data.gold);
  const long = `Bag full: salvaged ${name} +${gold} G`;
  if (long.length <= 40) return long;
  const mid = `Salvaged ${name} +${gold} G`;
  return mid.length <= 40 ? mid : `Salvaged +${gold} G`;
}
