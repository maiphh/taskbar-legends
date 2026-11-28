import { leapDisplayX } from './presentation';

/** Screen x inside the field (do not add field.x). Slot 0 is the front of that side. */
export function formationScreenX(side: 'hero' | 'enemy', slot: number, enemyCount: number, fieldWidth: number): number {
  const padL = 20;
  // At 480 physical pixels and 2× zoom, all six slots share 240 source pixels.
  const narrow = fieldWidth < 400;
  const padR = narrow ? 20 : 84;
  const usable = Math.max(120, fieldWidth - padL - padR);
  const center = Math.max(36, Math.floor(usable * (narrow ? 0.20 : 0.28)));
  const heroZone = Math.floor((usable - center) * (narrow ? 0.50 : 0.42));
  const enemyZone = usable - center - heroZone;
  const heroGap = heroZone / 2;
  const enemies = Math.max(1, enemyCount);
  const enemyGap = enemies <= 1 ? 0 : enemyZone / (enemies - 1);
  if (side === 'hero') return padL + (2 - Math.min(2, Math.max(0, slot))) * heroGap;
  return padL + heroZone + center + Math.max(0, slot) * enemyGap;
}

/** t is 0..1. 'out' goes slot to target. 'back' goes target to slot. 'hold' stays on the slot. */
export function slashScreenX(home: number, target: number, phase: 'out' | 'back' | 'hold', t: number): number {
  const u = Math.max(0, Math.min(1, t));
  if (phase === 'hold') return home;
  if (phase === 'out') return leapDisplayX(home, target, u * 0.5);
  return leapDisplayX(home, target, 0.5 + u * 0.5);
}
