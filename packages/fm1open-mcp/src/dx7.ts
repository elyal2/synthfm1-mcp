// Standard DX7 voice formats (public, widely documented): packed VMEM (128 bytes,
// as stored in 32-voice banks) to unpacked VCED (155 bytes). FM1 Open stores each
// track's patch as VCED plus one trailing byte (operator-enable mask, 63 = all on).
export const PATCH_BYTES = 156;

export function vmemToPatch(vm: ArrayLike<number>): Uint8Array {
  const v = new Uint8Array(PATCH_BYTES);
  for (let op = 0; op < 6; op++) {
    const o = op * 17;
    const b = op * 21;
    for (let i = 0; i < 8; i++) v[b + i] = vm[o + i]; // EG rates and levels
    v[b + 8] = vm[o + 8]; // break point
    v[b + 9] = vm[o + 9]; // left depth
    v[b + 10] = vm[o + 10]; // right depth
    v[b + 11] = vm[o + 11] & 3; // left curve
    v[b + 12] = (vm[o + 11] >> 2) & 3; // right curve
    v[b + 13] = vm[o + 12] & 7; // rate scaling
    v[b + 14] = vm[o + 13] & 3; // amp mod sensitivity
    v[b + 15] = (vm[o + 13] >> 2) & 7; // key velocity sensitivity
    v[b + 16] = vm[o + 14]; // output level
    v[b + 17] = vm[o + 15] & 1; // oscillator mode
    v[b + 18] = (vm[o + 15] >> 1) & 31; // coarse
    v[b + 19] = vm[o + 16]; // fine
    v[b + 20] = (vm[o + 12] >> 3) & 15; // detune
  }
  for (let i = 0; i < 8; i++) v[126 + i] = vm[102 + i]; // pitch EG
  v[134] = vm[110]; // algorithm
  v[135] = vm[111] & 7; // feedback
  v[136] = (vm[111] >> 3) & 1; // oscillator key sync
  v[137] = vm[112];
  v[138] = vm[113];
  v[139] = vm[114];
  v[140] = vm[115];
  v[141] = vm[116] & 1;
  v[142] = (vm[116] >> 1) & 7;
  v[143] = (vm[116] >> 4) & 7;
  v[144] = vm[117]; // transpose
  for (let i = 0; i < 10; i++) v[145 + i] = vm[118 + i]; // name
  v[155] = 63;
  return v;
}

export const patchName = (p: ArrayLike<number>) => String.fromCharCode(...Array.from({ length: 10 }, (_, i) => p[145 + i])).trim();
