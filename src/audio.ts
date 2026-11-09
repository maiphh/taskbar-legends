import manifest from './audio-manifest.json';
import type { GameEvent } from './core/model';

/**
 * Audio engine (docs/audio.md of the art handoff, ui/gacha.md §7). Presentation only: it reads events and UI cues and
 * never touches simulation state or the sim RNG. Gain = master × bus × clip.defaultVolume; buses master 0.5, music 0.3,
 * sfx 0.6, ui 0.5. Web Audio starts on the first user gesture; mute and volume persist in localStorage.
 */
export type Bus = 'music' | 'sfx' | 'ui';
interface Clip { key: string; bus: string; defaultVolume: number; sampleRate: number; paths: { ogg: string; mp3: string; m4a?: string }; loop?: { startSample: number; endSample: number } }
interface Group { variants?: string[]; playbackRateJitter?: number; minIntervalMs?: number; maxVoices?: number }
const CLIPS = new Map<string, Clip>((manifest.clips as Clip[]).map(clip => [clip.key, clip]));
const GROUPS = manifest.groups as Record<string, Group>;
export const AUDIO_STORAGE_KEY = 'taskbar-legends:audio';
export const DEFAULT_VOLUMES = manifest.defaultVolumes;
export interface AudioSettings { muted: boolean; volume: number }

/** master × bus × clip; master is the persisted volume (default 0.5), 0 when muted. */
export function clipGain(settings: AudioSettings, bus: Bus, clipVolume: number): number {
  return (settings.muted ? 0 : settings.volume) * DEFAULT_VOLUMES[bus] * clipVolume;
}
export function parseSettings(raw: string | null): AudioSettings {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === 'object' && 'muted' in value && 'volume' in value && typeof value.muted === 'boolean' && typeof value.volume === 'number' && value.volume >= 0 && value.volume <= 1)
      return { muted: value.muted, volume: value.volume };
  } catch { /* fall through to defaults */ }
  return { muted: false, volume: DEFAULT_VOLUMES.master };
}
export type Engine = 'chromium' | 'webkit' | 'other';
/**
 * Priming offsets measured with scripts/measure-aac-offset.ts (decodeAudioData lag search against the OGG decode):
 * Chromium 156 and WebKit 27.2 both trim the AAC priming from the M4A edit list (0); WebKit keeps the MP3 decoder delay
 * (1105 samples), Chromium trims it (0). OGG is 0 everywhere.
 */
export const PRIMING_OFFSETS: Record<Engine, Record<'ogg' | 'm4a' | 'mp3', number>> = {
  chromium: { ogg: 0, m4a: manifest.m4aOffsetSamples ?? 0, mp3: 0 },
  webkit: { ogg: 0, m4a: manifest.m4aOffsetSamples ?? 0, mp3: 1105 },
  other: { ogg: 0, m4a: manifest.m4aOffsetSamples ?? 0, mp3: 0 },
};
/** Loop clips: OGG when the browser decodes Vorbis, else the M4A/AAC copy (WebKit), MP3 last. One-shots: OGG, else MP3. */
export function chooseFormat(clip: { paths: { m4a?: string } ; loop?: unknown }, canPlay: (type: string) => boolean): 'ogg' | 'm4a' | 'mp3' {
  if (canPlay('audio/ogg; codecs="vorbis"')) return 'ogg';
  if (clip.loop && clip.paths.m4a && canPlay('audio/mp4; codecs="mp4a.40.2"')) return 'm4a';
  return 'mp3';
}
/** Loop window in seconds for a decoded buffer: samples 0..2,304,000 shifted by the format's priming offset. */
export function loopWindow(clip: { sampleRate: number; loop?: { startSample: number; endSample: number } }, offsetSamples: number): { start: number; end: number; offset: number } {
  const loop = clip.loop ?? { startSample: 0, endSample: 0 };
  return { start: (loop.startSample + offsetSamples) / clip.sampleRate, end: (loop.endSample + offsetSamples) / clip.sampleRate, offset: offsetSamples };
}
/** Variant group state: random variant, never the same twice in a row; minIntervalMs and maxVoices cap stacking. */
export class GroupGate {
  private last = new Map<string, { key: string; at: number }>();
  private voices = new Map<string, number[]>();
  constructor(private readonly random: () => number = Math.random) {}
  pick(group: string, now: number, durationMs: (key: string) => number): { key: string; rate: number } | null {
    const spec = GROUPS[group]; if (!spec?.variants?.length) return null;
    const previous = this.last.get(group);
    if (previous && spec.minIntervalMs && now - previous.at < spec.minIntervalMs) return null;
    const live = (this.voices.get(group) ?? []).filter(end => end > now);
    if (spec.maxVoices && live.length >= spec.maxVoices) { this.voices.set(group, live); return null; }
    const pool = spec.variants.length > 1 ? spec.variants.filter(key => key !== previous?.key) : spec.variants;
    const key = pool[Math.floor(this.random() * pool.length)] ?? spec.variants[0] ?? '';
    const jitter = spec.playbackRateJitter ?? 0, rate = 1 + (this.random() * 2 - 1) * jitter;
    this.last.set(group, { key, at: now }); live.push(now + durationMs(key) / rate); this.voices.set(group, live);
    return { key, rate };
  }
}
/** Event → cue keys (gacha cues come from the reveal, not from pull events). */
export function eventCues(event: GameEvent): string[] {
  const data = event.data;
  switch (data.type) {
    case 'hit': return data.side === 'enemy' ? ['group:hit'] : [];
    case 'death': return [data.side === 'enemy' ? 'enemy_death' : 'hero_death'];
    case 'gold': return data.reason === 'kill' ? ['group:coin_pickup'] : [];
    case 'clear': return data.first ? ['stage_clear'] : [];
    case 'stage': return data.mode === 'BOSS_FIGHT' ? ['boss_warning'] : [];
    case 'gear': case 'tickets': return ['drop_pop'];
    default: return [];
  }
}
export interface AudioAdapter {
  consume(events: readonly GameEvent[]): void;
  play(key: string): void;
  settings(): AudioSettings;
  set(settings: AudioSettings): void;
  debug(): { unlocked: boolean; engine: Engine; loaded: string[]; played: string[]; loop: { format: string; offsetSamples: number; loopStart: number; loopEnd: number } | null; settings: AudioSettings };
  dispose(): void;
}
function detectEngine(): Engine {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/Chrome|Chromium|Edg\//.test(ua)) return 'chromium';
  if (/AppleWebKit/.test(ua)) return 'webkit';
  return 'other';
}
export function createAudio(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): AudioAdapter {
  let settings = parseSettings(storage?.getItem(AUDIO_STORAGE_KEY) ?? null);
  const engine = detectEngine(), gate = new GroupGate(), played: string[] = [], buffers = new Map<string, AudioBuffer>();
  let context: AudioContext | null = null, master: GainNode | null = null, buses: Record<Bus, GainNode> | null = null, lastSeq = -1, disposed = false;
  let loop: { format: string; offsetSamples: number; loopStart: number; loopEnd: number } | null = null;
  const base = (): string => `${import.meta.env.BASE_URL}audio/`;
  const audioElement = typeof document === 'undefined' ? null : document.createElement('audio');
  const canPlay = (type: string): boolean => !!audioElement && audioElement.canPlayType(type) !== '';
  const formats = new Map<string, 'ogg' | 'm4a' | 'mp3'>();
  const apply = (): void => {
    if (!master || !buses || !context) return;
    master.gain.setValueAtTime(settings.muted ? 0 : settings.volume, context.currentTime);
    for (const bus of ['music', 'sfx', 'ui'] as const) buses[bus].gain.setValueAtTime(DEFAULT_VOLUMES[bus], context.currentTime);
  };
  async function load(clip: Clip): Promise<void> {
    if (!context) return;
    const format = chooseFormat(clip, canPlay); formats.set(clip.key, format);
    const path = clip.paths[format] ?? clip.paths.mp3;
    const response = await fetch(new URL(base() + path, window.location.href).href);
    buffers.set(clip.key, await context.decodeAudioData(await response.arrayBuffer()));
  }
  function startLoop(): void {
    const clip = CLIPS.get('ambient_loop'), buffer = buffers.get('ambient_loop');
    if (!context || !buses || !clip || !buffer || loop) return;
    const format = formats.get(clip.key) ?? 'ogg', offset = PRIMING_OFFSETS[engine][format], window = loopWindow(clip, offset);
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.loop = true; source.loopStart = window.start; source.loopEnd = window.end;
    gain.gain.value = clip.defaultVolume; source.connect(gain).connect(buses.music); source.start(0, window.start);
    loop = { format, offsetSamples: offset, loopStart: window.start, loopEnd: window.end };
  }
  function unlock(): void {
    if (context || disposed || typeof AudioContext === 'undefined') return;
    context = new AudioContext(); master = context.createGain(); master.connect(context.destination);
    buses = { music: context.createGain(), sfx: context.createGain(), ui: context.createGain() };
    for (const bus of Object.values(buses)) bus.connect(master);
    apply(); void context.resume();
    const ambient = CLIPS.get('ambient_loop');
    void Promise.all([...CLIPS.values()].map(clip => load(clip).catch(() => undefined))).then(() => { if (ambient) startLoop(); });
  }
  if (typeof window !== 'undefined') for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, unlock, { once: false, capture: true, passive: true });
  function playKey(key: string, rate = 1): void {
    played.push(key); if (played.length > 64) played.shift();
    const clip = CLIPS.get(key), buffer = buffers.get(key);
    if (!context || !buses || !clip || !buffer || settings.muted) return;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.playbackRate.value = rate; gain.gain.value = clip.defaultVolume;
    source.connect(gain).connect(buses[clip.bus as Bus] ?? buses.sfx); source.start();
  }
  function cue(key: string): void {
    if (key.startsWith('group:')) {
      const group = key.slice(6), pick = gate.pick(group, typeof performance === 'undefined' ? Date.now() : performance.now(), variant => (manifest.clips as { key: string; durationMs: number }[]).find(clip => clip.key === variant)?.durationMs ?? 300);
      if (pick) playKey(pick.key, pick.rate);
      return;
    }
    // gacha.md §4a: the legendary sting falls back to gacha_reveal_legendary when its key is not shipped.
    playKey(CLIPS.has(key) ? key : key === 'gacha_legendary_sting' ? 'gacha_reveal_legendary' : key);
  }
  return {
    consume(events) {
      const newest = events.at(-1)?.seq ?? 0;
      if (lastSeq < 0 || newest < lastSeq) { lastSeq = newest; return; }
      for (const event of events) if (event.seq > lastSeq) for (const key of eventCues(event)) cue(key);
      lastSeq = newest;
    },
    play: cue,
    settings: () => ({ ...settings }),
    set(next) { settings = { muted: next.muted, volume: Math.max(0, Math.min(1, next.volume)) }; storage?.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings)); apply(); },
    debug: () => ({ unlocked: context !== null, engine, loaded: [...buffers.keys()], played: [...played], loop, settings: { ...settings } }),
    dispose() { disposed = true; void context?.close(); context = null; },
  };
}
export const audio: AudioAdapter = createAudio();
