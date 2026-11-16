import { describe, expect, it } from 'vitest';
import { formationDrop } from '../src/management/formation';

describe('manual formation drop semantics', () => {
  const party = ['front', 'middle', 'rear'];
  const owned = [...party, 'bench'];
  it('swaps deployed heroes from slots or roster cards', () => {
    expect(formationDrop(party, owned, 'front', 2)).toEqual(['rear', 'middle', 'front']);
    expect(formationDrop(party, owned, 'rear', 0)).toEqual(['rear', 'middle', 'front']);
  });
  it('replaces a deployed hero with a benched hero and does not mutate inputs', () => {
    expect(formationDrop(party, owned, 'bench', 1)).toEqual(['front', 'bench', 'rear']);
    expect(party).toEqual(['front', 'middle', 'rear']);
  });
  it('returns no change for same-slot, unknown source, bad slot, or invalid current formation', () => {
    expect(formationDrop(party, owned, 'front', 0)).toBeNull();
    expect(formationDrop(party, owned, 'missing', 0)).toBeNull();
    expect(formationDrop(party, owned, 'bench', -1)).toBeNull();
    expect(formationDrop(party, owned, 'bench', 3)).toBeNull();
    expect(formationDrop(['front', 'front', 'rear'], owned, 'bench', 1)).toBeNull();
    expect(formationDrop(['front', 'middle'], owned, 'bench', 1)).toBeNull();
  });
});
