/** Guards async responses at the account boundary and prevents out-of-order snapshots from rolling back state. */
export function isCurrentAccountRequest(capturedGeneration: number, currentGeneration: number, capturedUserId: string, currentUserId: string | null): boolean {
  return capturedGeneration === currentGeneration && currentUserId === capturedUserId;
}

export function mayAcceptAccountSnapshot(currentUserId: string | null, incomingUserId: string | null, currentRevision: number, incomingRevision: number): boolean {
  if (!incomingUserId || incomingRevision < 0 || !Number.isSafeInteger(incomingRevision)) return false;
  if (currentUserId === null) return true;
  return currentUserId === incomingUserId && incomingRevision >= currentRevision;
}

/** Local persist/autosave while local or recoverable error, without a cloud snapshot. */
export function canPersistLocalAuthority(accountMode: string, hasCloudState: boolean): boolean {
  return (accountMode === 'local' || accountMode === 'error') && !hasCloudState;
}

/** Local restore/resumeSave only while local or recoverable error, unfrozen, and without a cloud snapshot. */
export function canRestoreLocalAuthority(accountMode: string, hasCloudState: boolean, localFrozenForAccount: boolean): boolean {
  return (accountMode === 'local' || accountMode === 'error') && !hasCloudState && !localFrozenForAccount;
}

/** Freeze local authority when entering connecting from local/error without a cloud snapshot. */
export function shouldFreezeLocalForConnecting(previousMode: string, hasCloudState: boolean): boolean {
  return !hasCloudState && (previousMode === 'local' || previousMode === 'error');
}

/** Checkpoint only a hydrated, visible, writable local save before freezing for account connect. */
export function shouldCheckpointLocalBeforeConnecting(
  localSaveHydrated: boolean,
  hidden: boolean,
  restoring: boolean,
  failedSave: boolean,
  checkpointBlocked: boolean,
): boolean {
  return localSaveHydrated && !hidden && !restoring && !failedSave && !checkpointBlocked;
}
