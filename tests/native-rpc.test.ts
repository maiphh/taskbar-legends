import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeRpc } from '../src/management/native-rpc';

afterEach(() => vi.useRealTimers());

describe('native management RPC lifetime', () => {
  it('settles rejected invokes immediately, retains one reply listener across close/reopen, and disposes it once', async () => {
    let receive: ((reply: { requestId: string }) => void) | undefined;
    let listenerCount = 0, unlistenCount = 0, failNext = true;
    const rpc = new NativeRpc(async handler => { listenerCount += 1; receive = handler; return () => { listenerCount -= 1; unlistenCount += 1; }; }, async id => {
      if (failNext) { failNext = false; throw new Error('invoke rejected'); }
      queueMicrotask(() => receive?.({ requestId: id }));
    }, 20);
    await expect(rpc.request('failed', {})).rejects.toThrow('invoke rejected');
    expect(listenerCount).toBe(1);
    const pending = rpc.request('closed', {});
    rpc.close();
    await expect(pending).rejects.toThrow('closed');
    expect(listenerCount).toBe(1);
    await expect(rpc.request('reopened', {})).resolves.toMatchObject({ requestId: 'reopened' });
    expect(listenerCount).toBe(1);
    await rpc.dispose();
    expect(listenerCount).toBe(0);
    expect(unlistenCount).toBe(1);
  });
  it('cancels requests waiting for listener readiness when disposed', async () => {
    let makeReady: ((unlisten: () => void) => void) | undefined, sends = 0, unlistens = 0;
    const rpc = new NativeRpc(async () => new Promise(resolve => { makeReady = resolve; }), async () => { sends += 1; }, 5);
    const request = rpc.request('not-ready', {});
    const disposed = rpc.dispose();
    makeReady?.(() => { unlistens += 1; });
    await expect(request).rejects.toThrow('closed');
    await disposed;
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(sends).toBe(0);
    expect(unlistens).toBe(1);
  });
  it('rejects queued requests immediately on close before a never-ready listener resolves', async () => {
    let resolveReady!: (unlisten: () => void) => void, sends = 0;
    const rpc = new NativeRpc(() => new Promise(resolve => { resolveReady = resolve; }), async () => { sends += 1; }, 1000);
    const pending = rpc.request('queued-close', {}), rejected = expect(pending).rejects.toThrow('closed');
    rpc.close();
    await rejected;
    expect(sends).toBe(0);
    resolveReady(vi.fn());
    await Promise.resolve(); await Promise.resolve();
    expect(sends).toBe(0);
  });
  it('includes listener readiness in the request deadline', async () => {
    vi.useFakeTimers();
    const rpc = new NativeRpc(() => new Promise(() => undefined), async () => undefined, 40);
    const pending = rpc.request('readiness-timeout', {}), rejected = expect(pending).rejects.toThrow('did not respond');
    await vi.advanceTimersByTimeAsync(40);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    rpc.dispose();
  });
  it('disposes without waiting for listener registration and unlistens if it later resolves', async () => {
    let resolveReady!: (unlisten: () => void) => void, sends = 0, unlistens = 0;
    const rpc = new NativeRpc(() => new Promise(resolve => { resolveReady = resolve; }), async () => { sends += 1; }, 100);
    const pending = rpc.request('dispose-waiter', {}), rejected = expect(pending).rejects.toThrow('closed');
    rpc.dispose();
    await rejected;
    resolveReady(() => { unlistens += 1; });
    await Promise.resolve(); await Promise.resolve();
    expect(sends).toBe(0);
    expect(unlistens).toBe(1);
  });
  it('rejects duplicate pending request IDs without replacing the original', async () => {
    let receive!: (reply: unknown) => void;
    const rpc = new NativeRpc(async handler => { receive = handler; return () => undefined; }, async () => undefined, 100);
    const first = rpc.request('duplicate', {});
    await Promise.resolve();
    await expect(rpc.request('duplicate', {})).rejects.toThrow('already pending');
    receive({ requestId: 'duplicate' });
    await expect(first).resolves.toEqual({ requestId: 'duplicate' });
    rpc.dispose();
  });
  it('settles queued requests when listener registration fails', async () => {
    const rpc = new NativeRpc(async () => { throw new Error('listen failed'); }, async () => undefined, 100);
    const pending = rpc.request('listen-failure', {});
    await expect(pending).rejects.toThrow('listen failed');
    rpc.dispose();
  });
  it('rejects a request when transport send never settles and clears the timeout', async () => {
    vi.useFakeTimers();
    const rpc = new NativeRpc(async () => () => undefined, async () => new Promise<void>(() => undefined), 50);
    try {
      const pending = rpc.request('stalled', {});
      const rejected = expect(pending).rejects.toThrow('did not respond');
      await Promise.resolve(); await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
      await rpc.dispose();
    } finally { vi.useRealTimers(); }
  });
});
