import { CONFIG } from './config';
export interface Rect { x: number; y: number; width: number; height: number }

export interface WelcomeLayout {
  panel: Rect;
  compact: boolean;
  close: Rect;
  capBar: Rect;
  gold: Rect;
  xp: Rect;
  chest: Rect;
  chestTitle: { x: number; y: number };
  chestRule: { x: number; y: number; width: number };
  chestGrid: { x: number; y: number; perRow: number; size: number; stride: number };
  chestSentY: number;
  party: Rect;
  partyTitle: { x: number; y: number; width: number };
  heroes: Rect[];
  clearSummary: { x: number; y: number; width: number };
  partialSummary: { x: number; y: number; width: number };
  rateSummary: { x: number; y: number; width: number };
  dividerY: number;
  saveNote: { x: number; y: number; width: number };
  collect: Rect;
}

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

/** Resolve welcome content once from source pixels; callers use these same rects for paint and hit testing. */
export function welcomeLayout(sourceWidth: number, slots: number): WelcomeLayout {
  const width = Math.max(1, Math.floor(sourceWidth));
  const compact = width < CONFIG.ui.expanded.panelWidth + CONFIG.ui.expanded.panelRightInset + 16;
  const panelWidth = Math.min(CONFIG.ui.expanded.panelWidth, Math.max(1, width - (width >= 480 ? 16 : 8)));
  const panelX = compact ? Math.max(0, Math.floor((width - panelWidth) / 2)) : width - panelWidth - CONFIG.ui.expanded.panelRightInset;
  const panel = rect(panelX, 0, panelWidth, compact ? 424 : CONFIG.ui.expanded.panelHeight);

  if (!compact) {
    const spec = CONFIG.ui.offlineRewards.layout;
    const [barX = 16, barY = 66, barWidth = 688, barHeight = 6] = spec.capBar;
    const [goldX = 16, goldY = 80, goldWidth = 440, goldHeight = 64] = spec.goldRow;
    const [xpX = 16, xpY = 152, xpWidth = 440, xpHeight = 64] = spec.xpRow;
    const tileRects = [0, 1, 2].map(index => rect(472 + index * 76, 120, 64, 80));
    const [cx = 16, cy = 224, cw = 440, ch = 120] = spec.chestRow;
    const gridSlots = Math.max(4, slots), perRow = gridSlots > 16 ? 14 : gridSlots > 8 ? Math.min(gridSlots, 8) : Math.min(gridSlots, 8);
    const size = gridSlots > 16 ? 26 : gridSlots > 8 ? 28 : spec.chestSlot.size;
    const stride = gridSlots > 16 ? 29 : gridSlots > 8 ? 34 : spec.chestSlot.stride;
    const [px = 464, py = 80, pw = 240, ph = 264] = spec.partyPanel;
    const [collectX = 536, collectY = 364, collectWidth = 168, collectHeight = 28] = spec.collectRect;
    return {
      panel, compact, close: rect(680, 8, 28, 24), capBar: rect(barX, barY, barWidth, barHeight),
      gold: rect(goldX, goldY, goldWidth, goldHeight), xp: rect(xpX, xpY, xpWidth, xpHeight), chest: rect(cx, cy, cw, ch),
      chestTitle: { x: cx + 16, y: cy + 8 }, chestRule: { x: cx + 16, y: cy + 8, width: cw - 40 },
      chestGrid: { x: spec.chestSlot.x, y: spec.chestSlot.y, perRow, size, stride }, chestSentY: cy + ch - 22,
      party: rect(px, py, pw, ph), partyTitle: { x: px + 12, y: py + 10, width: pw - 24 }, heroes: tileRects,
      clearSummary: { x: px + 12, y: 252, width: pw - 24 }, partialSummary: { x: px + 12, y: 270, width: pw - 24 },
      rateSummary: { x: px + 12, y: 288, width: pw - 24 }, dividerY: 357,
      saveNote: { x: 16, y: 368, width: 500 }, collect: rect(collectX, collectY, collectWidth, collectHeight),
    };
  }

  const inner = Math.max(1, panelWidth - 32), gap = 8, rewardWidth = Math.floor((inner - gap) / 2);
  const chestX = 16, chestY = 148, chestWidth = inner, gridColumns = Math.max(1, Math.min(14, Math.floor((chestWidth - 32 + 2) / 28)));
  const chestSize = Math.min(26, Math.max(20, Math.floor((chestWidth - 32 - (gridColumns - 1) * 2) / gridColumns)));
  const chestStride = chestSize + 2, gridRows = Math.ceil(Math.max(4, slots) / gridColumns), gridY = chestY + 36;
  const chestHeight = 36 + gridRows * chestStride + 15;
  const partyY = chestY + chestHeight + 6, heroGap = 6, heroWidth = Math.floor((inner - heroGap * 2) / 3);
  const heroRects = [0, 1, 2].map(index => rect(16 + index * (heroWidth + heroGap), partyY + 20, heroWidth, 58));
  const summaryY = partyY + 80;
  const collectWidth = 120, collectHeight = 28, collectX = panelWidth - 16 - collectWidth, collectY = 392;
  return {
    panel, compact, close: rect(panelWidth - 44, 8, 28, 24), capBar: rect(16, 66, inner, 6),
    gold: rect(16, 80, rewardWidth, 58), xp: rect(16 + rewardWidth + gap, 80, inner - rewardWidth - gap, 58),
    chest: rect(chestX, chestY, chestWidth, chestHeight),
    chestTitle: { x: chestX + 12, y: chestY + 7 }, chestRule: { x: chestX + 12, y: chestY + 23, width: chestWidth - 24 },
    chestGrid: { x: chestX + 16, y: gridY, perRow: gridColumns, size: chestSize, stride: chestStride }, chestSentY: gridY + gridRows * chestStride - 2,
    party: rect(16, partyY, inner, 80), partyTitle: { x: 28, y: partyY + 2, width: inner - 24 }, heroes: heroRects,
    clearSummary: { x: 16, y: summaryY, width: inner }, partialSummary: { x: 16, y: summaryY + 16, width: inner },
    rateSummary: { x: 16, y: summaryY + 32, width: inner }, dividerY: collectY - 2,
    saveNote: { x: 16, y: 398, width: Math.max(40, collectX - 24) }, collect: rect(collectX, collectY, collectWidth, collectHeight),
  };
}
