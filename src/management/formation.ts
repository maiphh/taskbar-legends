/** Resolve a deliberate manual formation drop. Returns null for an invalid or unchanged drop. */
export function formationDrop(partyIds: readonly string[], ownedIds: readonly string[], heroId: string, targetSlot: number): string[] | null {
  if (partyIds.length !== 3 || new Set(partyIds).size !== 3 || partyIds.some(id => !ownedIds.includes(id))) return null;
  if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot >= 3 || !ownedIds.includes(heroId)) return null;
  if (partyIds[targetSlot] === heroId) return null;
  const next = [...partyIds], sourceSlot = next.indexOf(heroId);
  if (sourceSlot >= 0) [next[sourceSlot], next[targetSlot]] = [next[targetSlot]!, next[sourceSlot]!];
  else next[targetSlot] = heroId;
  return new Set(next).size === 3 && next.every(id => ownedIds.includes(id)) ? next : null;
}
