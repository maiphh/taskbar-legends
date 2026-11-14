export type CompactLaneRect = { x: number; y: number; width: number; height: number };
export type CompactLaneLayout = {
  progress: CompactLaneRect;
  field: { x: number; width: number };
  actions: CompactLaneRect;
};

/** Compact party-v2 lane: full-bleed field; progress/actions islands are unused (width 0). */
export function compactLaneLayout(width: number): CompactLaneLayout {
  return {
    progress: { x: 0, y: 0, width: 0, height: 0 },
    field: { x: 0, width },
    actions: { x: 0, y: 0, width: 0, height: 0 },
  };
}
