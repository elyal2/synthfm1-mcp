# synthfm1-mcp

[MCP](https://modelcontextprotocol.io) servers that let an AI assistant drive an **M-VAVE FM-1** synthesizer over USB MIDI: read and write sounds and patterns, build songs, and play a `.mid` file live on the synth's tracks.

> Unofficial, personal project. Not affiliated with or endorsed by M-VAVE, Felucca, or Baud Girl. "FM-1" and "M-VAVE" belong to their owners.

## Packages

| Package | Firmware on the FM-1 | Status |
|---|---|---|
| [`packages/felucca-mcp`](packages/felucca-mcp) | [Felucca](https://github.com/hugelton/Felucca) (GPL-3.0, open source) | Works. Tested on Felucca v1.8.1 |
| [`packages/baudgirl-mcp`](packages/baudgirl-mcp) | Baud Girl's FM-1+VA (closed source) | Experimental, **disabled by default** (see below) |
| [`packages/fm1-midi-mcp`](packages/fm1-midi-mcp) | Any firmware (or any MIDI synth) | Works. Notes only, over USB or Bluetooth LE MIDI |

The first two are independent because they talk to different firmware with different protocols. `fm1-midi-mcp` is the firmware-agnostic one: it only needs a MIDI input.

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
- Tested over Bluetooth with Groove OS 2.0. Felucca and SLOOP never enable the radio, so for them use USB (or a Bluetooth-MIDI-to-TRS adapter).

```bash
cd packages/fm1-midi-mcp && npm install && npm run typecheck
```

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

The Felucca client follows the public protocol document in the Felucca repo (`web/EDITOR_PROTOCOL.md`), implemented independently; no Felucca source is copied here. The Baud Girl side was learned by reading their public web app's behaviour and confirmed on real hardware.

## License

[MIT](LICENSE).
