import { cloneState } from '../core/model';
import type { GameState } from '../core/model';

/** Copy only server-owned economy into a local animation clone; clock/phase visuals keep advancing per frame. */
export function syncPresentationEconomy(presentation: GameState, authoritative: GameState): void {
  const confirmed = cloneState(authoritative);
  presentation.gold = confirmed.gold; presentation.tickets = confirmed.tickets; presentation.pity = confirmed.pity;
  presentation.inventory = confirmed.inventory; presentation.roster = confirmed.roster;
  presentation.pendingChoice = confirmed.pendingChoice; presentation.stats = confirmed.stats;
  presentation.progress = confirmed.progress; presentation.highestCleared = confirmed.highestCleared;
  presentation.partyIds = confirmed.partyIds; presentation.partyPreset = confirmed.partyPreset;
  presentation.economyRevision = confirmed.economyRevision;
  presentation.nextGearId = confirmed.nextGearId; presentation.farmChestDry = confirmed.farmChestDry;
  presentation.pityLegendary = confirmed.pityLegendary; presentation.pityNewHero = confirmed.pityNewHero;
  presentation.gearSinceLegendary = confirmed.gearSinceLegendary; presentation.gearLegendaryFound = confirmed.gearLegendaryFound;
  presentation.farmProofs = confirmed.farmProofs; presentation.metrics = confirmed.metrics;
  presentation.offlineAccrual = confirmed.offlineAccrual; presentation.offlineTicketFrac = confirmed.offlineTicketFrac;
}
