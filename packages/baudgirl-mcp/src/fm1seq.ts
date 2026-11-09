// Loads Baud Girl's own fm1seq.js / fm1preset.js from baudgirl.com at call time
// and calls their exported functions instead of re-implementing the SysEx
// framing here: their code, their checksum, their byte layout.
//
// Pinned to one app build so a vendor update can't silently change what we
// send; if Baud Girl ships a new build this URL starts 404ing and the loader
// throws, which is the point.
//
// OPT-IN: that JavaScript is proprietary ("all rights reserved") and is neither
// bundled nor redistributed here. It is only downloaded, and executed in this
// process, when BAUDGIRL_ALLOW_REMOTE_JS=1 is set, so the user decides to run it.
const BASE = "https://baudgirl.com/fm1/app/1919c9e1477d2fee/";

function requireOptIn(): void {
  if (process.env.BAUDGIRL_ALLOW_REMOTE_JS !== "1") {
    throw new Error(
      "baudgirl-mcp is disabled by default: it downloads and runs Baud Girl's proprietary " +
        "fm1seq.js/fm1preset.js from baudgirl.com. Read the README, then set " +
        "BAUDGIRL_ALLOW_REMOTE_JS=1 in this server's environment to enable it.",
    );
  }
}

export type Fm1Bank = {
  steps: Uint8Array;
  set: Uint8Array;
  locks: Uint8Array;
  hasLocks: boolean;
  tempo: number;
  current?: number;
};

export type Fm1Reply = {
  kind: "sound" | "mem" | "pattern" | "unknown";
  status: number;
  arg: number;
  data: Uint8Array;
};

export type Fm1Note = { note: number; vel: number };
export type Fm1Step = { rate: number; notes: Fm1Note[]; locks: { what: number; value: number }[] };

export interface Fm1SeqModule {
  STEPS: number;
  PATTERNS: number;
  STEP_BYTES: number;
  SET_BYTES: number;
  MAX_NOTES: number;
  GSET_RAM: number;
  GSET_LEN: number;
  LK_RAM: number;
  REPEATS: number[];
  STATUS_TEXT: Record<number, string>;
  emptyBank(): Fm1Bank;
  patSteps(b: Fm1Bank, p: number): Uint8Array;
  patSet(b: Fm1Bank, p: number): Uint8Array;
  patLocks(b: Fm1Bank, p: number): Uint8Array;
  samePattern(a: Fm1Bank, b: Fm1Bank, p: number): boolean;
  addNote(P: Uint8Array, k: number, note: number, vel: number): boolean;
  removeNote(P: Uint8Array, k: number, note: number): boolean;
  setStepOption(
    P: Uint8Array,
    k: number,
    which: "gate" | "chance" | "transpose",
    value: number | null,
    length: number,
  ): void;
  setStepLength(P: Uint8Array, k: number, rate: number): void;
  chainOf(byte: number): { next: number | null; repeats: number };
  bankPattern(
    b: Fm1Bank,
    p: number,
  ): { length: number; rate: number; gate: number; swing: number; steps: Fm1Step[] };
  encodeStepsPart(
    set: Uint8Array,
    steps: Uint8Array,
    pat: number,
    part: number,
    save: boolean,
  ): Uint8Array;
  encodeLocksRaw(tab64: Uint8Array, pat: number, eighth: number, save: boolean): Uint8Array;
  encodeMemRead(addr: number, n: number): Uint8Array;
  patternRequests(p: number): { addr: number; n: number }[];
  setPatternFromReads(
    b: Fm1Bank,
    p: number,
    answers: Uint8Array[],
    gset: Uint8Array,
    mark: Uint8Array,
  ): boolean;
  decodeReply(frame: Uint8Array): Fm1Reply | null;
}

export type Fm1Preset = { slot: number; voice: Uint8Array; record: Uint8Array };

export interface Fm1PresetModule {
  VOICE_N: number;
  EDIT_N: number;
  REC_N: number;
  PRESETS: number;
  encodePresetRead(slot: number): Uint8Array;
  presetFromReply(r: Fm1Reply): Fm1Preset;
  encodeExact(slot: number, voice: Uint8Array, record: Uint8Array): Uint8Array;
  voiceName(voice: Uint8Array): string;
  withName(voice: Uint8Array, name: string): Uint8Array;
  packVoice(edit155: Uint8Array): Uint8Array;
  unpackVoice(voice128: Uint8Array): Uint8Array;
  engineOf(record: Uint8Array, slot: number): unknown;
}

export type Fm1 = { seq: Fm1SeqModule; preset: Fm1PresetModule };

async function fetchText(path: string): Promise<string> {
  const res = await fetch(BASE + path);
  if (!res.ok) {
    throw new Error(
      `Could not fetch ${path} (${res.status}) from ${BASE}. Baud Girl likely shipped a new build; re-pin BASE.`,
    );
  }
  return res.text();
}

const toDataUrl = (code: string) =>
  `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;

let cached: Promise<Fm1> | null = null;

export function loadFm1(): Promise<Fm1> {
  requireOptIn();
  if (!cached) {
    cached = (async () => {
      const seqUrl = toDataUrl(await fetchText("fm1seq.js"));
      const presetCode = (await fetchText("fm1preset.js")).replace(
        /from\s+"\.\/fm1seq\.js"/g,
        `from "${seqUrl}"`,
      );
      const seq = (await import(seqUrl)) as unknown as Fm1SeqModule;
      const preset = (await import(toDataUrl(presetCode))) as unknown as Fm1PresetModule;
      return { seq, preset };
    })();
  }
  return cached;
}

export async function loadFm1Seq(): Promise<Fm1SeqModule> {
  return (await loadFm1()).seq;
}
