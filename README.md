# synthfm1-mcp

[MCP](https://modelcontextprotocol.io) servers that let an AI assistant drive an **M-VAVE FM-1** synthesizer over USB MIDI: read and write sounds and patterns, build songs, and play a `.mid` file live on the synth's tracks.

> Unofficial, personal project. Not affiliated with or endorsed by M-VAVE, Felucca, or Baud Girl. "FM-1" and "M-VAVE" belong to their owners.

## Packages

| Package | Firmware on the FM-1 | Status |
|---|---|---|
| [`packages/felucca-mcp`](packages/felucca-mcp) | [Felucca](https://github.com/hugelton/Felucca) (GPL-3.0, open source) | Works. Tested on Felucca v1.8.1 |
| [`packages/baudgirl-mcp`](packages/baudgirl-mcp) | Baud Girl's FM-1+VA (closed source) | Experimental, **disabled by default** (see below) |
| [`packages/fm1-midi-mcp`](packages/fm1-midi-mcp) | Any firmware (or any MIDI synth) | Works. Notes only, over USB or Bluetooth LE MIDI |
| [`packages/fm1open-mcp`](packages/fm1open-mcp) | [FM1 Open V14](https://github.com/m-vave/fm1_open) (M-VAVE's official open firmware) | Client and scripts, **not an MCP server yet**. Tested on one unit over USB and Bluetooth |

`felucca-mcp`, `baudgirl-mcp` and `fm1open-mcp` are independent because they talk to different firmware with different protocols. `fm1-midi-mcp` is the firmware-agnostic one: it only needs a MIDI input.

## felucca-mcp

Speaks Felucca's documented editor SysEx protocol (`F0 7D 46 4C …`). Tools:

| Tool | What it does |
|---|---|
| `felucca_status` | Version, engines, the 4 tracks, BPM, song chain |
| `felucca_list_presets` / `felucca_set_sound` | Choose engine + preset per track |
| `felucca_params` | Read/write any track or global parameter (BPM is global 0) |
| `felucca_write_steps` | Write notes, ties and rests into a track's 64-step pattern |
| `felucca_import_midi` | Split a MIDI file into project slots and chain them as a song (max 4 distinct 64-step chunks) |
| `felucca_play_midi` / `felucca_stop_play` | The computer acts as the sequencer and streams a whole `.mid` to the 4 tracks over MIDI channels 1-4. No slot limit |
| `felucca_song`, `felucca_project` | Song chain and project slot control |

Example prompt: *"Play this MIDI: bass from track 5 on an analog bass, the piano on FM6, drums on the drum track."* GM drum notes go straight to Felucca's DRUM engine.

### Requirements

- Node.js 20+ and an FM-1 running Felucca, connected by USB (MIDI port named "Felucca"). Felucca's MIDI IN routing must be `CH1-4` for live playback.
- A C++ toolchain: the [`midi`](https://www.npmjs.com/package/midi) package builds a native module. npm may ask you to approve its install script (`npm approve-scripts midi`).

```bash
cd packages/felucca-mcp
npm install
npm run typecheck
```

### Register it (Claude Code example)

```json
{
  "mcpServers": {
    "felucca": {
      "command": "/absolute/path/to/synthfm1-mcp/packages/felucca-mcp/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/synthfm1-mcp/packages/felucca-mcp/src/server.ts"]
    }
  }
}
```

## fm1-midi-mcp (any firmware, USB or Bluetooth)

Plays a `.mid` file live (the computer is the sequencer) to any MIDI output port, plus `send_note`, `program_change`, `cc`, `stop_play` and `list_midi_ports`. No SysEx and no replies from the synth are needed, so it works the same over USB and over **Bluetooth LE MIDI**.

- You map each track of the file to a MIDI channel; the synth decides what each channel plays.
- `loop`, `fromBeat` and `maxBeats` let you repeat or skip parts.
- On macOS, connect Bluetooth MIDI first: *Audio MIDI Setup → Window → Show MIDI Studio → Bluetooth*, then use a port-name substring such as `FM-1_BLE`.
- Tested over Bluetooth LE MIDI on an FM-1 running M-VAVE's stock firmware V15 (it shows up as `FM-1_BLE Bluetooth`). Groove OS advertises Bluetooth MIDI too but is untested here.
- Felucca and SLOOP never enable the radio, so for them use USB (or a Bluetooth-MIDI-to-TRS adapter).
- The stock firmware plays **one preset at a time on every channel**, so mapping several tracks to several channels just layers them on the same sound; use one track (or `program_change`) there. Firmware with one sound per track (Felucca, SLOOP, Groove OS) is where multi-channel mapping shines.

```bash
cd packages/fm1-midi-mcp && npm install && npm run typecheck
```

## fm1open-mcp (FM1 Open V14, USB or Bluetooth)

FM1 Open V14 has 8 tracks, one MIDI input channel per track, and a documented project-transfer SysEx (`F0 7D 46 4D 02 cmd …`, described in the comment at the top of the firmware's `app/transfer.c`). This package implements that protocol independently, plus the project layout from `app/instrument.h`. It is a TypeScript client with scripts for now; wrapping it as an MCP server is the obvious next step.

| Script (`npm run …`) | What it does |
|---|---|
| `probe <port>` | Read-only: device info, capabilities, the 16 slot names, and a backup of the working project into `backups/` |
| `dump <port>` | Read-only: every track's steps and the 128 DX7 library voice names |
| `analyze <file.mid>` | Note counts per 4-bar window and MIDI track, to choose sections |
| `songs <template.bin> [--write <port>] [--only 0,1]` | Converts MIDI sections into project slots (steps, ties, gates, 808 pad masks, DX7 voice from the library). Without `--write` it only prints |
| `play-slot <port> <slot>` | Loads a stored slot and runs it with MIDI Start/Stop |
| `jam <port> <slot>` | Loops a slot on the synth's own clock and plays a generated lead on a free track over MIDI |

The song definitions in `build-songs.mts` are examples that expect your own `.mid` files in `~/Documents/FM-1-midi-examples/`; none are included.

- Ports show up as `FM1 Community` over USB and `FM1 Community_BLE Bluetooth` over Bluetooth; any substring works (`BLE`). Reading the whole 4 KB project takes about 4 s over Bluetooth.
- `write` replaces the **working project** (RAM) and `saveSlot` persists it. Back up first (`probe` does), and keep your own projects in slots you don't use from the device: saving from the synth's panel overwrites a slot silently.
- The synth's project browser starts in the FACTORY bank; switch it to USER with K1 to reach stored slots.
- Not verified: how notes, ties and gates sound beyond one listening session, the GM-to-808 drum mapping, and any firmware other than V14.

## baudgirl-mcp (experimental, opt-in)

Reads/writes patterns (16 x 64 steps, chaining), scans and writes presets, imports MIDI to an 8-Bit preset's lanes, on the Baud Girl FM-1+VA firmware.

Baud Girl's protocol is not published. This package gets the exact byte layout by **downloading Baud Girl's own `fm1seq.js` / `fm1preset.js` from baudgirl.com at runtime and calling their functions**. That code is proprietary ("all rights reserved"), so:

- It is **not** included in this repository and is never saved to disk.
- It runs only if you set `BAUDGIRL_ALLOW_REMOTE_JS=1` in the server's environment. Without it every tool that needs it refuses with an explanation.
- It is pinned to one site build; if Baud Girl changes the site, the loader fails loudly instead of sending unknown bytes.

Enabling it means you run third-party proprietary JavaScript in a Node process on your machine. Read it first, and consider asking Baud Girl for permission before relying on this.

## Safety

- Write tools overwrite things on the synth (patterns, presets, project slots, and `felucca_import_midi` mutes unused tracks). **Back up first**; Felucca has full-device backup commands.
- Nothing here flashes firmware.
- A language model can't hear the result. You judge by ear and tell it what to change.
- Don't commit MIDI files or firmware images you don't own; `.gitignore` excludes them.

## How it was built

The Felucca client follows the public protocol document in the Felucca repo (`web/EDITOR_PROTOCOL.md`), implemented independently; no Felucca source is copied here. The FM1 Open client follows the protocol comment and struct definitions in M-VAVE's `fm1_open` repo (GPLv3 with linking exception); only the documented wire format and field layout were used, no source is copied. The Baud Girl side was learned by reading their public web app's behaviour and confirmed on real hardware.

## License

[MIT](LICENSE).
