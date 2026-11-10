export interface RpcReply { requestId: string }
interface Pending<TReply> {
  timer: ReturnType<typeof setTimeout>;
  generation: number;
  payload: unknown;
  resolve: (reply: TReply) => void;
  reject: (error: Error) => void;
}

/** A single lifetime reply listener with bounded, cancellable request promises. */
export class NativeRpc<TReply extends RpcReply = RpcReply> {
  private readonly pending = new Map<string, Pending<TReply>>();
  private unlisten?: () => void;
  private generation = 0;
  private disposed = false;
  private ready = false;
  private readyError?: Error;

  constructor(
    listen: (receive: (reply: unknown) => void) => Promise<() => void>,
    private readonly send: (requestId: string, payload: unknown) => Promise<void>,
    private readonly timeoutMs = 5000,
    private readonly validate: (value: unknown) => value is TReply = ((value: unknown): value is TReply => typeof value === 'object' && value !== null && 'requestId' in value && typeof value.requestId === 'string'),
  ) {
    let registration: Promise<() => void>;
    try { registration = listen(value => this.receive(value)); }
    catch (error) { registration = Promise.reject(error); }
    void registration.then(unlisten => {
      if (this.disposed) { unlisten(); return; }
      this.unlisten = unlisten; this.ready = true;
      for (const [id, entry] of this.pending) this.dispatch(id, entry);
    }).catch(error => {
      this.readyError = asError(error);
      for (const [id, entry] of this.pending) this.settleFailure(id, entry, this.readyError);
    });
  }

  request(requestId: string, payload: unknown): Promise<TReply> {
    if (this.disposed) return Promise.reject(new Error('Management client has been disposed.'));
    if (this.pending.has(requestId)) return Promise.reject(new Error('A request with this ID is already pending.'));
    const generation = this.generation;
    return new Promise<TReply>((resolve, reject) => {
      const entry: Pending<TReply> = { timer: setTimeout(() => this.settleFailure(requestId, entry, new Error('Game authority did not respond.')), this.timeoutMs), generation, payload, resolve, reject };
      this.pending.set(requestId, entry);
      if (this.readyError) this.settleFailure(requestId, entry, this.readyError);
      else if (this.ready) this.dispatch(requestId, entry);
    });
  }

  close(): void {
    this.generation += 1;
    for (const [id, entry] of this.pending) this.settleFailure(id, entry, new Error('Management view closed.'));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.close();
    this.unlisten?.(); this.unlisten = undefined;
    // If registration is still pending, its completion observes disposed and unlistens then.
  }

  private receive(value: unknown): void {
    const requestId = typeof value === 'object' && value !== null && 'requestId' in value && typeof value.requestId === 'string' ? value.requestId : '';
    const entry = this.pending.get(requestId);
    if (!entry) return;
    if (!this.validate(value)) this.settleFailure(requestId, entry, new Error('Game authority returned a malformed reply.'));
    else {
      this.pending.delete(requestId); clearTimeout(entry.timer); entry.resolve(value);
    }
  }

  private dispatch(requestId: string, entry: Pending<TReply>): void {
    if (this.pending.get(requestId) !== entry) return;
    if (this.disposed || entry.generation !== this.generation) { this.settleFailure(requestId, entry, new Error('Management view closed.')); return; }
    if (this.readyError) { this.settleFailure(requestId, entry, this.readyError); return; }
    try { void this.send(requestId, entry.payload).catch(error => this.settleFailure(requestId, entry, asError(error))); }
    catch (error) { this.settleFailure(requestId, entry, asError(error)); }
  }

  private settleFailure(requestId: string, entry: Pending<TReply>, error: Error): void {
    if (this.pending.get(requestId) !== entry) return;
    this.pending.delete(requestId); clearTimeout(entry.timer); entry.reject(error);
  }
}

function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
