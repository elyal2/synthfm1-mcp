import type { Fm1, Fm1Bank, Fm1Preset } from "./fm1seq.js";
import { Link, sleep } from "./link.js";

const eq = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((x, i) => x === b[i]);

// ---- patterns ----------------------------------------------------------

async function mem(link: Link, fm1: Fm1, addr: number, n: number): Promise<Uint8Array> {
  const S = fm1.seq;
  const r = await link.ask(S.encodeMemRead(addr, n), (f) => {
    const d = S.decodeReply(f);
    return d && d.kind === "mem" && d.arg === addr ? d : null;
  });
  if (r.status !== 0) throw new Error(`The FM-1+VA refused a memory read (status ${r.status}).`);
  return r.data;
}

/** Reads patterns `pats` into a bank (steps, settings, chain byte, locks). */
export async function readPatterns(link: Link, fm1: Fm1, pats: number[]): Promise<Fm1Bank> {
  const S = fm1.seq;
  const bank = S.emptyBank();
  const gset = await mem(link, fm1, S.GSET_RAM, S.GSET_LEN);
  const mark = await mem(link, fm1, S.LK_RAM, 4);
  bank.tempo = gset[66] | (gset[67] << 8);
  for (const p of pats) {
    const answers: Uint8Array[] = [];
    for (const q of S.patternRequests(p)) answers.push(await mem(link, fm1, q.addr, q.n));
    bank.hasLocks = S.setPatternFromReads(bank, p, answers, gset, mark);
  }
  bank.current = gset[114] & 15;
  return bank;
}

export function describePattern(fm1: Fm1, bank: Fm1Bank, p: number) {
  const S = fm1.seq;
  const pat = S.bankPattern(bank, p);
  const set = S.patSet(bank, p);
  const chain = S.chainOf(set[4]);
  return {
    pattern: p,
    stepsLength: pat.length,
    rate: pat.rate,
    gate: pat.gate,
    swing: pat.swing,
    chain: chain.next === null ? "repeat" : { next: chain.next, repeats: chain.repeats },
    tempo: bank.tempo,
    steps: pat.steps
      .map((s, k) => ({ step: k, notes: s.notes, locks: s.locks }))
      .filter((s) => s.notes.length || s.locks.length),
  };
}

export type StepSpec = {
  step: number;
  notes: { note: number; vel: number }[];
  length?: number;
  gate?: number | null;
  chance?: number | null;
  transpose?: number;
};

export type PatternSpec = {
  stepsLength: number;
  rate: number;
  gate: number;
  swing: number;
  chain: "repeat" | { next: number; repeats: number };
  steps: StepSpec[];
};

/** Builds the bank the device should hold for pattern `p`, using Baud Girl's own step editor. */
export function buildWanted(fm1: Fm1, p: number, spec: PatternSpec): Fm1Bank {
  const S = fm1.seq;
  const bank = S.emptyBank();
  const P = S.patSteps(bank, p);
  const set = S.patSet(bank, p);
  set[0] = spec.gate;
  set[1] = spec.swing;
  set[2] = spec.rate;
  set[3] = spec.stepsLength;
  if (spec.chain === "repeat") set[4] = 0;
  else {
    const idx = S.REPEATS.indexOf(spec.chain.repeats);
    if (idx < 0) throw new Error(`repeats must be one of ${S.REPEATS.join(", ")}`);
    set[4] = 0x80 | (idx << 4) | (spec.chain.next & 15);
  }
  for (const st of spec.steps) {
    for (const n of st.notes) {
      if (!S.addNote(P, st.step, n.note, n.vel)) {
        throw new Error(`step ${st.step} cannot hold more than ${S.MAX_NOTES} notes`);
      }
    }
  }
  for (const st of spec.steps) {
    if (st.length !== undefined) S.setStepLength(P, st.step, st.length);
    if (st.gate !== undefined) S.setStepOption(P, st.step, "gate", st.gate, spec.stepsLength);
    if (st.chance !== undefined) S.setStepOption(P, st.step, "chance", st.chance, spec.stepsLength);
    if (st.transpose !== undefined)
      S.setStepOption(P, st.step, "transpose", st.transpose, spec.stepsLength);
  }
  return bank;
}

type PlanItem = { kind: "steps"; pat: number; part: number } | { kind: "locks"; pat: number; eighth: number };

function plan(fm1: Fm1, current: Fm1Bank, wanted: Fm1Bank, p: number): PlanItem[] {
  const S = fm1.seq;
  const out: PlanItem[] = [];
  const after = Uint8Array.from(current.locks);
  const mine: number[] = [];
  for (let q = 0; q < 16; q++) {
    const a = S.patSteps(current, p).subarray(q * 128, q * 128 + 128);
    const b = S.patSteps(wanted, p).subarray(q * 128, q * 128 + 128);
    if (!eq(a, b)) mine.push(q);
  }
  if (!mine.length && !eq(S.patSet(current, p), S.patSet(wanted, p))) mine.push(0);
  for (const q of mine) {
    out.push({ kind: "steps", pat: p, part: q });
    after.fill(0xff, p * 512 + q * 32, p * 512 + q * 32 + 32);
  }
  for (let e = 0; e < 8; e++) {
    const o = p * 512 + e * 64;
    if (!eq(after.subarray(o, o + 64), wanted.locks.subarray(o, o + 64)))
      out.push({ kind: "locks", pat: p, eighth: e });
  }
  return out;
}

function messageFor(fm1: Fm1, wanted: Fm1Bank, item: PlanItem, save: boolean) {
  const S = fm1.seq;
  if (item.kind === "steps") {
    return {
      msg: S.encodeStepsPart(
        S.patSet(wanted, item.pat),
        S.patSteps(wanted, item.pat).subarray(item.part * 128, item.part * 128 + 128),
        item.pat,
        item.part,
        save,
      ),
      arg: item.pat | (item.part << 8) | 0x4000,
    };
  }
  return {
    msg: S.encodeLocksRaw(
      S.patLocks(wanted, item.pat).subarray(item.eighth * 64, item.eighth * 64 + 64),
      item.pat,
      item.eighth,
      save,
    ),
    arg: item.pat | (item.eighth << 8) | 0x8000,
  };
}

/** Diff-writes pattern `p` (acknowledged message by message, last one saves), then reads it back. */
export async function writePattern(
  link: Link,
  fm1: Fm1,
  p: number,
  spec: PatternSpec,
  save: boolean,
): Promise<{ messages: number; verified: boolean; describe: ReturnType<typeof describePattern> }> {
  const S = fm1.seq;
  const wanted = buildWanted(fm1, p, spec);
  const current = await readPatterns(link, fm1, [p]);
  const items = plan(fm1, current, wanted, p);
  for (let k = 0; k < items.length; k++) {
    const last = k === items.length - 1;
    const { msg, arg } = messageFor(fm1, wanted, items[k], save && last);
    const r = await link.ask(
      msg,
      (f) => {
        const d = S.decodeReply(f);
        return d && d.kind === "pattern" && d.arg === arg ? d : null;
      },
      last ? 4000 : 1500,
    );
    if (r.status !== 0) {
      throw new Error(
        `FM-1+VA refused message ${k + 1}/${items.length}: ${S.STATUS_TEXT[r.status] ?? `status ${r.status}`}`,
      );
    }
  }
  const back = await readPatterns(link, fm1, [p]);
  return {
    messages: items.length,
    verified: S.samePattern(back, wanted, p),
    describe: describePattern(fm1, back, p),
  };
}

// ---- presets -----------------------------------------------------------

export async function readPreset(link: Link, fm1: Fm1, slot: number): Promise<Fm1Preset> {
  const S = fm1.seq;
  const r = await link.ask(fm1.preset.encodePresetRead(slot), (f) => {
    const d = S.decodeReply(f);
    return d && d.kind === "sound" && d.arg === slot ? d : null;
  });
  return fm1.preset.presetFromReply(r);
}

export async function scanPresets(link: Link, fm1: Fm1, from = 0, to = 127) {
  const out: { slot: number; name: string; engine: string; blank: boolean }[] = [];
  for (let slot = from; slot <= to; slot++) {
    const p = await readPreset(link, fm1, slot);
    out.push({
      slot,
      name: fm1.preset.voiceName(p.voice).trim(),
      engine: String(fm1.preset.engineOf(p.record, slot)),
      blank: p.voice.some((b) => b > 127),
    });
  }
  return out;
}

export async function writePreset(
  link: Link,
  fm1: Fm1,
  args: { slot: number; baseSlot?: number; name?: string; vced?: number[] },
): Promise<{ slot: number; name: string; verified: boolean }> {
  const V = fm1.preset;
  const base = await readPreset(link, fm1, args.baseSlot ?? args.slot);
  let voice = base.voice;
  if (args.vced) {
    if (args.vced.length !== V.EDIT_N) throw new Error(`vced must be ${V.EDIT_N} bytes (a DX7 edit buffer)`);
    voice = V.packVoice(Uint8Array.from(args.vced));
  }
  if (args.name) voice = V.withName(voice, args.name);
  link.send(V.encodeExact(args.slot, voice, base.record));
  await sleep(300);
  const back = await readPreset(link, fm1, args.slot);
  return {
    slot: args.slot,
    name: V.voiceName(back.voice).trim(),
    verified: eq(back.voice, voice) && eq(back.record, base.record),
  };
}
