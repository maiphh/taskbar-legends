import type { Action } from './core/model';
export interface InputHandlers { action(action: Action): void; togglePause(): void; cheapestUpgrade(): void }
export function bindInput(handlers: InputHandlers): void {
  const on = (id: string, action: () => void): void => { document.getElementById(id)?.addEventListener('click', action); };
  on('pause', handlers.togglePause); on('retry', () => handlers.action({ type: 'retry' }));
  on('pull', () => handlers.action({ type: 'pull' }));
  on('equip', () => { handlers.action({ type: 'autoParty' }); handlers.action({ type: 'autoEquip' }); });
  on('upgrade', handlers.cheapestUpgrade);
  window.addEventListener('keydown', event => {
    if (event.target instanceof HTMLButtonElement || event.repeat) return;
    switch (event.code) {
      case 'Space': event.preventDefault(); handlers.togglePause(); break;
      case 'KeyR': handlers.action({ type: 'retry' }); break;
      case 'KeyP': handlers.action({ type: 'pull' }); break;
      case 'KeyE': handlers.action({ type: 'autoParty' }); handlers.action({ type: 'autoEquip' }); break;
      case 'KeyU': handlers.cheapestUpgrade(); break;
    }
  });
}
