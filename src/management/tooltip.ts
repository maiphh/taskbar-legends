const TOOLTIP_ID = 'px-management-tooltip';

/** One safe, viewport-clamped tooltip layer shared by hover, focus and dedicated help taps. */
export class ManagementTooltip {
  private readonly node = document.createElement('div');
  private readonly abort = new AbortController();
  private target: HTMLElement | null = null;
  private hoverTarget: HTMLElement | null = null;
  private timer = 0;
  private generation = 0;
  private priorDescription: string | null = null;
  private pinned = false;

  constructor(private readonly root: HTMLElement) {
    this.node.id = TOOLTIP_ID; this.node.className = 'px-tooltip'; this.node.setAttribute('role', 'tooltip'); this.node.hidden = true;
    document.body.append(this.node);
    root.addEventListener('pointerover', event => this.onPointerOver(event), { signal: this.abort.signal });
    root.addEventListener('pointerout', event => this.onPointerOut(event), { signal: this.abort.signal });
    root.addEventListener('focusin', event => { const anchor = this.anchor(event.target); if (anchor) this.show(anchor, false); }, { signal: this.abort.signal });
    root.addEventListener('focusout', event => { if (event.target === this.target && !this.pinned && this.hoverTarget !== this.target) this.scheduleHide(100); }, { signal: this.abort.signal });
    document.addEventListener('pointerdown', event => { if (this.pinned && event.target instanceof Node && !this.target?.contains(event.target)) this.hide(); }, { capture: true, signal: this.abort.signal });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && this.dismissEscape()) { event.preventDefault(); event.stopPropagation(); } }, { capture: true, signal: this.abort.signal });
    root.addEventListener('scroll', () => this.hide(), { capture: true, signal: this.abort.signal });
    window.addEventListener('resize', () => this.hide(), { signal: this.abort.signal });
    document.addEventListener('scroll', () => this.hide(), { capture: true, signal: this.abort.signal });
  }

  private anchor(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>('[data-help]') : null;
  }
  private onPointerOver(event: PointerEvent): void {
    if (event.pointerType === 'touch' || this.pinned) return;
    const target = this.anchor(event.target); if (!target || target.contains(event.relatedTarget as Node | null)) return;
    if (this.hoverTarget === target) return;
    this.clearTimer(); this.hoverTarget = target;
    if (this.target && this.target !== target) this.clearTarget();
    const generation = ++this.generation;
    this.timer = window.setTimeout(() => {
      if (generation === this.generation && this.hoverTarget === target && this.root.contains(target)) this.show(target, false);
      else if (!this.root.contains(target)) this.hide();
    }, 250);
  }
  private onPointerOut(event: PointerEvent): void {
    if (this.pinned) return;
    const target = this.anchor(event.target); if (!target) return;
    const next = event.relatedTarget;
    if (next instanceof Node && target.contains(next)) return;
    if (this.hoverTarget === target) { this.hoverTarget = null; this.clearTimer(); }
    if (this.target === target) this.scheduleHide(100);
  }
  private clearTimer(): void { if (this.timer) window.clearTimeout(this.timer); this.timer = 0; }
  private scheduleHide(delay: number): void { this.clearTimer(); const generation = this.generation; this.timer = window.setTimeout(() => { if (generation === this.generation) this.hide(); }, delay); }
  private show(target: HTMLElement, pinned: boolean): void {
    this.clearTimer(); this.generation += 1;
    if (this.target && this.target !== target) this.clearTarget();
    const prior = target.getAttribute('aria-describedby');
    this.priorDescription = prior?.split(/\s+/).filter(value => value && value !== TOOLTIP_ID).join(' ') || null;
    this.target = target; this.pinned = pinned;
    const help = target.dataset.help?.trim(); if (!help || !this.root.contains(target)) { this.hide(); return; }
    target.setAttribute('aria-describedby', [this.priorDescription, TOOLTIP_ID].filter(Boolean).join(' '));
    this.node.textContent = help; this.node.hidden = false; this.position(target);
  }
  private position(target: HTMLElement): void {
    const rect = target.getBoundingClientRect(), tip = this.node.getBoundingClientRect(), padding = 8;
    const width = Math.min(280, window.innerWidth - padding * 2), left = Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding));
    const above = rect.top - tip.height - 8 >= padding, top = above ? rect.top - tip.height - 8 : Math.min(window.innerHeight - tip.height - padding, rect.bottom + 8);
    Object.assign(this.node.style, { left: `${left}px`, top: `${Math.max(padding, top)}px`, maxWidth: `${width}px` });
  }
  toggle(target: HTMLElement): void {
    if (this.pinned && this.target === target) { this.hide(); return; }
    this.show(target, true);
  }
  hide(): void {
    this.clearTimer(); this.generation += 1; this.pinned = false;
    this.hoverTarget = null; this.clearTarget();
  }
  private clearTarget(): void {
    if (this.target) this.removeDescription(this.target);
    this.target = null; this.priorDescription = null; this.node.hidden = true; this.node.textContent = '';
  }
  private removeDescription(target: HTMLElement): void {
    const described = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(value => value && value !== TOOLTIP_ID);
    if (described.length) target.setAttribute('aria-describedby', described.join(' ')); else target.removeAttribute('aria-describedby');
  }
  dismissEscape(): boolean { if (this.node.hidden) return false; this.hide(); return true; }
  dispose(): void { this.hide(); this.abort.abort(); this.node.remove(); }
}
