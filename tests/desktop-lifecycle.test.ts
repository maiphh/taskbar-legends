import { describe, expect, it } from 'vitest';
import { createExit } from '../src/platform/desktop/lifecycle';

describe('desktop save-then-exit', () => {
  it('writes the save before asking the native shell to exit, exactly once', async () => {
    const calls: string[] = [];
    const exit = createExit(() => calls.push('save'), command => { calls.push(command); return Promise.resolve(); });
    await Promise.all([exit('quit_app'), exit('quit_app'), exit('relaunch_app')]);
    expect(calls).toEqual(['save', 'quit_app']);
  });
  it('does not exit when the save write itself throws', async () => {
    const calls: string[] = [];
    const exit = createExit(() => { throw new Error('storage full'); }, command => { calls.push(command); return Promise.resolve(); });
    await expect(exit('relaunch_app')).rejects.toThrow('storage full');
    expect(calls).toEqual([]);
  });
});
