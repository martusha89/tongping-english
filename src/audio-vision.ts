import type { LiveAudioChunk } from "./browser-manager.js";

export type AudioVisionState =
  | "calm"
  | "steady"
  | "build"
  | "peak"
  | "release";

export interface AudioVisionPoint {
  capturedAt: number;
  mediaTime: number | null;
  loudnessDb: number;
  energy: number;
  bass: number;
  mid: number;
  treble: number;
  spectralCentroidHz: number;
  brightness: number;
  onsetDensity: number;
  pitchHz: number | null;
  pitchConfidence: number;
  chroma: number[];
  key: string | null;
  keyConfidence: number;
  harmonicChange: number;
  bpm: number | null;
  beatPhase: number | null;
  state: AudioVisionState;
}

export interface AudioVisionEvent {
  at: number;
  mediaTime: number | null;
  type: "section_change";
  from: AudioVisionState;
  to: AudioVisionState;
  energyDelta: number;
  bassDelta: number;
  onsetDelta: number;
  harmonicChange: number;
}

export interface AudioVisionReadout {
  ready: boolean;
  profile: string;
  seconds: number;
  latest: AudioVisionPoint | null;
  timeline: AudioVisionPoint[];
  events: AudioVisionEvent[];
  sectionRibbon: Array<{
    state: AudioVisionState;
    startAt: number;
    endAt: number;
    startMediaTime: number | null;
    endMediaTime: number | null;
  }>;
  summary: {
    state: AudioVisionState | null;
    bpm: number | null;
    key: string | null;
    energy: number | null;
    brightness: number | null;
    rhythmicDensity: number | null;
    harmonicChange: number | null;
  };
}

const FFT_SIZE = 1024;
const HISTORY_MS = 120_000;
const ONSET_WINDOW_MS = 4_000;
const EVENT_WINDOW_MS = 3_000;
const KEY_NAMES = [
  "C", "C#", "D", "D#", "E", "F",
  "F#", "G", "G#", "A", "A#", "B",
] as const;

const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
  2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
  2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

export class AudioVisionAnalyzer {
  private readonly history: AudioVisionPoint[] = [];
  private readonly events: AudioVisionEvent[] = [];
  private previousSpectrum: Float64Array | null = null;
  private previousChroma: number[] | null = null;
  private readonly onsetTimes: number[] = [];
  private lastState: AudioVisionState = "calm";

  constructor(private readonly profile: string) {}

  ingest(chunk: LiveAudioChunk): AudioVisionPoint | null {
    if (!chunk.buffer.length || chunk.sampleRate <= 0) return null;

    const samples = pcm16ToFloat(chunk.buffer);
    if (samples.length < 64) return null;

    const analysis = prepareWindow(samples, FFT_SIZE);
    const spectrum = fftMagnitude(analysis);
    const nyquist = chunk.sampleRate / 2;
    const binHz = chunk.sampleRate / FFT_SIZE;

    const rms = Math.sqrt(
      samples.reduce((sum, value) => sum + value * value, 0) /
        Math.max(1, samples.length),
    );
    const loudnessDb = clamp(
      20 * Math.log10(Math.max(rms, 1e-6)),
      -120,
      0,
    );
    const energy = clamp01((loudnessDb + 60) / 54);

    const bands = bandEnergies(spectrum, binHz, nyquist);
    const spectralCentroidHz = centroid(spectrum, binHz);
    const brightness = clamp01(
      spectralCentroidHz / Math.max(1, Math.min(12_000, nyquist)),
    );

    const flux = spectralFlux(spectrum, this.previousSpectrum);
    const fluxBaseline = this.recentFluxBaseline();
    const isOnset =
      flux > Math.max(0.025, fluxBaseline * 1.7) &&
      energy > 0.06;

    if (isOnset) this.onsetTimes.push(chunk.capturedAt);
    trimNumberTimes(
      this.onsetTimes,
      chunk.capturedAt - Math.max(ONSET_WINDOW_MS, 15_000),
    );

    const onsetDensity =
      this.onsetTimes.filter(
        (at) => at >= chunk.capturedAt - ONSET_WINDOW_MS,
      ).length /
      (ONSET_WINDOW_MS / 1000);

    const pitch = estimatePitch(samples, chunk.sampleRate);
    const chroma = computeChroma(spectrum, binHz);
    const keyInfo = estimateKey(chroma);
    const harmonicChange = chromaDistance(chroma, this.previousChroma);
    const bpm = estimateBpm(this.onsetTimes);
    const beatPhase =
      bpm && this.onsetTimes.length
        ? beatPhaseFromOnset(
            chunk.capturedAt,
            this.onsetTimes[this.onsetTimes.length - 1]!,
            bpm,
          )
        : null;

    const state = classifyState({
      energy,
      bass: bands.bass,
      onsetDensity,
      harmonicChange,
      previous: this.recentPoints(EVENT_WINDOW_MS),
      previousState: this.lastState,
    });

    const point: AudioVisionPoint = {
      capturedAt: chunk.capturedAt,
      mediaTime:
        Number.isFinite(chunk.mediaTime) && chunk.mediaTime >= 0
          ? chunk.mediaTime
          : null,
      loudnessDb: round(loudnessDb, 2),
      energy: round(energy, 4),
      bass: round(bands.bass, 4),
      mid: round(bands.mid, 4),
      treble: round(bands.treble, 4),
      spectralCentroidHz: round(spectralCentroidHz, 1),
      brightness: round(brightness, 4),
      onsetDensity: round(onsetDensity, 3),
      pitchHz: pitch.hz ? round(pitch.hz, 1) : null,
      pitchConfidence: round(pitch.confidence, 3),
      chroma: chroma.map((value) => round(value, 4)),
      key: keyInfo.key,
      keyConfidence: round(keyInfo.confidence, 3),
      harmonicChange: round(harmonicChange, 4),
      bpm: bpm ? round(bpm, 1) : null,
      beatPhase: beatPhase === null ? null : round(beatPhase, 3),
      state,
    };

    const previous = this.history[this.history.length - 1] ?? null;
    if (
      previous &&
      previous.state !== state &&
      shouldEmitSectionChange(previous, point)
    ) {
      this.events.push({
        at: chunk.capturedAt,
        mediaTime: point.mediaTime,
        type: "section_change",
        from: previous.state,
        to: state,
        energyDelta: round(point.energy - previous.energy, 4),
        bassDelta: round(point.bass - previous.bass, 4),
        onsetDelta: round(
          point.onsetDensity - previous.onsetDensity,
          3,
        ),
        harmonicChange: point.harmonicChange,
      });
    }

    this.history.push(point);
    trimPoints(this.history, chunk.capturedAt - HISTORY_MS);
    trimEvents(this.events, chunk.capturedAt - HISTORY_MS);

    this.previousSpectrum = spectrum;
    this.previousChroma = chroma;
    this.lastState = state;
    return point;
  }

  hasData(): boolean {
    return this.history.length > 0;
  }

  read(seconds = 5): AudioVisionReadout {
    const safeSeconds = Math.max(1, Math.min(30, seconds));
    const latest = this.history[this.history.length - 1] ?? null;
    const cutoff = latest
      ? latest.capturedAt - safeSeconds * 1000
      : Date.now() - safeSeconds * 1000;

    const timeline = this.history.filter(
      (point) => point.capturedAt >= cutoff,
    );
    const events = this.events.filter((event) => event.at >= cutoff);

    return {
      ready: Boolean(latest),
      profile: this.profile,
      seconds: safeSeconds,
      latest,
      timeline,
      events,
      sectionRibbon: buildRibbon(timeline),
      summary: summarize(timeline),
    };
  }

  private recentPoints(windowMs: number): AudioVisionPoint[] {
    const latest = this.history[this.history.length - 1];
    if (!latest) return [];
    const cutoff = latest.capturedAt - windowMs;
    return this.history.filter((point) => point.capturedAt >= cutoff);
  }

  private recentFluxBaseline(): number {
    if (!this.history.length) return 0.02;
    const recent = this.history.slice(-20);
    const harmonic = recent.reduce(
      (sum, point) => sum + point.harmonicChange,
      0,
    ) / Math.max(1, recent.length);
    const onset = recent.reduce(
      (sum, point) => sum + point.onsetDensity,
      0,
    ) / Math.max(1, recent.length);
    return clamp(0.018 + harmonic * 0.08 + onset * 0.006, 0.018, 0.12);
  }
}

function pcm16ToFloat(buffer: Buffer): Float64Array {
  const count = Math.floor(buffer.length / 2);
  const result = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const value = buffer.readInt16LE(i * 2);
    result[i] = value < 0 ? value / 32768 : value / 32767;
  }
  return result;
}

function prepareWindow(
  samples: Float64Array,
  size: number,
): Float64Array {
  const result = new Float64Array(size);
  const start = Math.max(0, samples.length - size);
  for (let i = 0; i < size; i += 1) {
    const sample = samples[start + i] ?? 0;
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    result[i] = sample * window;
  }
  return result;
}

function fftMagnitude(input: Float64Array): Float64Array {
  const n = input.length;
  const real = Float64Array.from(input);
  const imag = new Float64Array(n);

  let j = 0;
  for (let i = 1; i < n; i += 1) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const temp = real[i]!;
      real[i] = real[j]!;
      real[j] = temp;
    }
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wLenCos = Math.cos(angle);
    const wLenSin = Math.sin(angle);

    for (let i = 0; i < n; i += length) {
      let wCos = 1;
      let wSin = 0;
      for (let k = 0; k < length / 2; k += 1) {
        const uReal = real[i + k]!;
        const uImag = imag[i + k]!;
        const vReal =
          real[i + k + length / 2]! * wCos -
          imag[i + k + length / 2]! * wSin;
        const vImag =
          real[i + k + length / 2]! * wSin +
          imag[i + k + length / 2]! * wCos;

        real[i + k] = uReal + vReal;
        imag[i + k] = uImag + vImag;
        real[i + k + length / 2] = uReal - vReal;
        imag[i + k + length / 2] = uImag - vImag;

        const nextCos = wCos * wLenCos - wSin * wLenSin;
        const nextSin = wCos * wLenSin + wSin * wLenCos;
        wCos = nextCos;
        wSin = nextSin;
      }
    }
  }

  const half = n / 2;
  const spectrum = new Float64Array(half);
  for (let i = 0; i < half; i += 1) {
    spectrum[i] = Math.hypot(real[i]!, imag[i]!) / half;
  }
  return spectrum;
}

function bandEnergies(
  spectrum: Float64Array,
  binHz: number,
  nyquist: number,
): { bass: number; mid: number; treble: number } {
  const totals = { bass: 0, mid: 0, treble: 0 };
  let overall = 0;

  for (let i = 1; i < spectrum.length; i += 1) {
    const freq = i * binHz;
    if (freq > nyquist) break;
    const power = spectrum[i]! * spectrum[i]!;
    overall += power;
    if (freq < 250) totals.bass += power;
    else if (freq < 2_000) totals.mid += power;
    else totals.treble += power;
  }

  if (overall <= 1e-12) return totals;
  return {
    bass: totals.bass / overall,
    mid: totals.mid / overall,
    treble: totals.treble / overall,
  };
}

function centroid(
  spectrum: Float64Array,
  binHz: number,
): number {
  let numerator = 0;
  let denominator = 0;
  for (let i = 1; i < spectrum.length; i += 1) {
    const magnitude = spectrum[i]!;
    numerator += i * binHz * magnitude;
    denominator += magnitude;
  }
  return denominator > 1e-12 ? numerator / denominator : 0;
}

function spectralFlux(
  current: Float64Array,
  previous: Float64Array | null,
): number {
  if (!previous || previous.length !== current.length) return 0;
  let flux = 0;
  let total = 0;
  for (let i = 0; i < current.length; i += 1) {
    const delta = current[i]! - previous[i]!;
    if (delta > 0) flux += delta;
    total += current[i]!;
  }
  return total > 1e-9 ? flux / total : 0;
}

function estimatePitch(
  samples: Float64Array,
  sampleRate: number,
): { hz: number | null; confidence: number } {
  const minHz = 60;
  const maxHz = 1_000;
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(
    samples.length - 2,
    Math.ceil(sampleRate / minHz),
  );
  if (maxLag <= minLag) return { hz: null, confidence: 0 };

  let energy = 0;
  for (const value of samples) energy += value * value;
  if (energy / samples.length < 1e-5) {
    return { hz: null, confidence: 0 };
  }

  let bestLag = 0;
  let best = -Infinity;
  const scores = new Float64Array(maxLag + 1);

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let left = 0;
    let right = 0;
    const limit = samples.length - lag;
    for (let i = 0; i < limit; i += 1) {
      const a = samples[i]!;
      const b = samples[i + lag]!;
      sum += a * b;
      left += a * a;
      right += b * b;
    }
    const score = sum / (Math.sqrt(left * right) + 1e-12);
    scores[lag] = score;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }

  if (bestLag === 0 || best < 0.28) {
    return { hz: null, confidence: clamp01(best) };
  }

  // Autocorrelation often gives nearly-equal peaks at integer multiples of
  // the true period. Prefer the earliest strong local peak to avoid the
  // common octave-down error (for example 440 Hz being reported as 220 Hz).
  const strongThreshold = Math.max(0.42, best * 0.9);
  for (let lag = minLag + 1; lag < bestLag; lag += 1) {
    if (
      scores[lag]! >= strongThreshold &&
      scores[lag]! >= scores[lag - 1]! &&
      scores[lag]! >= scores[lag + 1]!
    ) {
      bestLag = lag;
      best = scores[lag]!;
      break;
    }
  }

  return {
    hz: sampleRate / bestLag,
    confidence: clamp01((best - 0.25) / 0.75),
  };
}

function computeChroma(
  spectrum: Float64Array,
  binHz: number,
): number[] {
  const chroma = Array.from({ length: 12 }, () => 0);
  for (let i = 1; i < spectrum.length; i += 1) {
    const freq = i * binHz;
    if (freq < 55 || freq > 5_000) continue;
    const midi = 69 + 12 * Math.log2(freq / 440);
    const pitchClass = mod(Math.round(midi), 12);
    chroma[pitchClass]! += spectrum[i]!;
  }
  const total = chroma.reduce((sum, value) => sum + value, 0);
  if (total <= 1e-12) return chroma;
  return chroma.map((value) => value / total);
}

function estimateKey(chroma: number[]): {
  key: string | null;
  confidence: number;
} {
  const total = chroma.reduce((sum, value) => sum + value, 0);
  if (total <= 1e-9) return { key: null, confidence: 0 };

  let bestScore = -Infinity;
  let secondScore = -Infinity;
  let bestKey = "";

  for (let root = 0; root < 12; root += 1) {
    for (const pair of [
      ["major", MAJOR_PROFILE],
      ["minor", MINOR_PROFILE],
    ] as const) {
      const mode = pair[0];
      const profile = pair[1];
      let score = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < 12; i += 1) {
        const a = chroma[i]!;
        const b = profile[mod(i - root, 12)]!;
        score += a * b;
        normA += a * a;
        normB += b * b;
      }
      score /= Math.sqrt(normA * normB) + 1e-12;

      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        bestKey = KEY_NAMES[root] + " " + mode;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
  }

  return {
    key: bestKey || null,
    confidence: clamp01((bestScore - secondScore) * 5),
  };
}

function chromaDistance(
  current: number[],
  previous: number[] | null,
): number {
  if (!previous || previous.length !== current.length) return 0;
  let dot = 0;
  let a2 = 0;
  let b2 = 0;
  for (let i = 0; i < current.length; i += 1) {
    const a = current[i]!;
    const b = previous[i]!;
    dot += a * b;
    a2 += a * a;
    b2 += b * b;
  }
  const cosine = dot / (Math.sqrt(a2 * b2) + 1e-12);
  return clamp01(1 - cosine);
}

function estimateBpm(onsets: number[]): number | null {
  if (onsets.length < 4) return null;
  const recent = onsets.slice(-16);
  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i += 1) {
    let interval = recent[i]! - recent[i - 1]!;
    if (interval < 180 || interval > 2_000) continue;
    while (interval < 333) interval *= 2;
    while (interval > 1_000) interval /= 2;
    intervals.push(interval);
  }
  if (intervals.length < 3) return null;
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)]!;
  const bpm = 60_000 / median;
  return bpm >= 50 && bpm <= 190 ? bpm : null;
}

function beatPhaseFromOnset(
  now: number,
  lastOnset: number,
  bpm: number,
): number {
  const period = 60_000 / bpm;
  return mod(now - lastOnset, period) / period;
}

function classifyState(input: {
  energy: number;
  bass: number;
  onsetDensity: number;
  harmonicChange: number;
  previous: AudioVisionPoint[];
  previousState: AudioVisionState;
}): AudioVisionState {
  const energy = input.energy;
  const bass = input.bass;
  const onsetDensity = input.onsetDensity;
  const harmonicChange = input.harmonicChange;
  const previous = input.previous;

  if (energy < 0.16 && onsetDensity < 1.0) return "calm";
  if (energy > 0.77 && (bass > 0.23 || onsetDensity > 4.5)) return "peak";

  if (previous.length >= 4) {
    const first = previous[0]!;
    const last = previous[previous.length - 1]!;
    const energyDelta = energy - (first.energy + last.energy) / 2;
    const rhythmDelta =
      onsetDensity - (first.onsetDensity + last.onsetDensity) / 2;

    if (energyDelta > 0.13 || rhythmDelta > 1.3) return "build";
    if (energyDelta < -0.14 || rhythmDelta < -1.2) return "release";
  }

  if (
    input.previousState === "build" &&
    energy > 0.62 &&
    (bass > 0.2 || harmonicChange > 0.28)
  ) {
    return "peak";
  }

  return "steady";
}

function shouldEmitSectionChange(
  previous: AudioVisionPoint,
  current: AudioVisionPoint,
): boolean {
  const magnitude =
    Math.abs(current.energy - previous.energy) * 1.4 +
    Math.abs(current.bass - previous.bass) * 0.8 +
    Math.abs(current.onsetDensity - previous.onsetDensity) * 0.08 +
    current.harmonicChange * 1.2;
  return magnitude >= 0.32;
}

function summarize(points: AudioVisionPoint[]): AudioVisionReadout["summary"] {
  if (!points.length) {
    return {
      state: null,
      bpm: null,
      key: null,
      energy: null,
      brightness: null,
      rhythmicDensity: null,
      harmonicChange: null,
    };
  }

  const latest = points[points.length - 1]!;
  const avg = (pick: (point: AudioVisionPoint) => number) =>
    points.reduce((sum, point) => sum + pick(point), 0) / points.length;

  const bpmValues = points
    .map((point) => point.bpm)
    .filter((value): value is number => value !== null);
  const keyScores = new Map<string, number>();
  for (const point of points) {
    if (!point.key) continue;
    keyScores.set(
      point.key,
      (keyScores.get(point.key) ?? 0) + point.keyConfidence,
    );
  }
  const key =
    [...keyScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    latest.key;

  return {
    state: latest.state,
    bpm:
      bpmValues.length > 0
        ? round(
            bpmValues.reduce((sum, value) => sum + value, 0) /
              bpmValues.length,
            1,
          )
        : null,
    key,
    energy: round(avg((point) => point.energy), 4),
    brightness: round(avg((point) => point.brightness), 4),
    rhythmicDensity: round(
      avg((point) => point.onsetDensity),
      3,
    ),
    harmonicChange: round(
      avg((point) => point.harmonicChange),
      4,
    ),
  };
}

function buildRibbon(
  points: AudioVisionPoint[],
): AudioVisionReadout["sectionRibbon"] {
  if (!points.length) return [];
  const ribbon: AudioVisionReadout["sectionRibbon"] = [];

  let current = {
    state: points[0]!.state,
    startAt: points[0]!.capturedAt,
    endAt: points[0]!.capturedAt,
    startMediaTime: points[0]!.mediaTime,
    endMediaTime: points[0]!.mediaTime,
  };

  for (const point of points.slice(1)) {
    if (point.state === current.state) {
      current.endAt = point.capturedAt;
      current.endMediaTime = point.mediaTime;
      continue;
    }
    ribbon.push(current);
    current = {
      state: point.state,
      startAt: point.capturedAt,
      endAt: point.capturedAt,
      startMediaTime: point.mediaTime,
      endMediaTime: point.mediaTime,
    };
  }
  ribbon.push(current);
  return ribbon;
}

function trimPoints(points: AudioVisionPoint[], cutoff: number): void {
  while (points.length && points[0]!.capturedAt < cutoff) points.shift();
}

function trimEvents(events: AudioVisionEvent[], cutoff: number): void {
  while (events.length && events[0]!.at < cutoff) events.shift();
}

function trimNumberTimes(times: number[], cutoff: number): void {
  while (times.length && times[0]! < cutoff) times.shift();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** A decoded mono/stereo PCM16 window cut from the buffered Watch Together audio. */
export interface AudioPcmWindow {
  buffer: Buffer;
  sampleRate: number;
  channels: number;
  startMediaTime: number;
  capturedAtStart: number;
}

/**
 * Run a fresh analyzer over one PCM window (1024-frame hops). `mediaTimeOffset`
 * shifts every point's mediaTime, e.g. from the HLS clock onto the source
 * video's clock so audio lines up with that video's subtitles and lyrics.
 */
export function analyzePcmWindow(
  profile: string,
  pcm: AudioPcmWindow,
  seconds: number,
  mediaTimeOffset = 0,
): AudioVisionReadout {
  const analyzer = new AudioVisionAnalyzer(profile);
  for (const chunk of pcmHops(pcm, mediaTimeOffset)) analyzer.ingest(chunk);
  return analyzer.read(seconds);
}

/**
 * The same analysis on a shared server: it yields to the event loop every few
 * dozen hops so a long window never stalls live streams. Returns the analyzer
 * so callers can read several spans from one cut.
 */
export async function analyzePcmWindowAsync(
  profile: string,
  pcm: AudioPcmWindow,
  mediaTimeOffset = 0,
  hopsPerSlice = 48,
): Promise<AudioVisionAnalyzer> {
  const analyzer = new AudioVisionAnalyzer(profile);
  let count = 0;
  for (const chunk of pcmHops(pcm, mediaTimeOffset)) {
    analyzer.ingest(chunk);
    if (++count % hopsPerSlice === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  return analyzer;
}

function* pcmHops(pcm: AudioPcmWindow, mediaTimeOffset: number): Generator<LiveAudioChunk> {
  const bytesPerFrame = pcm.channels * 2;
  const windowBytes = 1024 * bytesPerFrame;
  let sequence = 0;
  for (let offset = 0; offset + 128 <= pcm.buffer.length; offset += windowBytes) {
    const chunk = pcm.buffer.subarray(offset, Math.min(pcm.buffer.length, offset + windowBytes));
    const frames = Math.floor(chunk.length / bytesPerFrame);
    if (frames < 64) continue;
    const elapsedSeconds = offset / bytesPerFrame / pcm.sampleRate;
    yield {
      buffer: Buffer.from(chunk),
      sampleRate: pcm.sampleRate,
      channels: pcm.channels,
      frames,
      sequence: ++sequence,
      capturedAt: pcm.capturedAtStart + Math.round(elapsedSeconds * 1000),
      mediaTime: pcm.startMediaTime + elapsedSeconds + mediaTimeOffset,
    };
  }
}
