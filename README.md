# PLG150-AN Web Editor

Browser editor/librarian for the Yamaha PLG150-AN plug-in board in a Modular Synthesis
Plug-in host synth. It talks to the board with the **PLG150-AN Native** SysEx messages.

You can use it directly at this link: https://urtzurd.github.io/plg150-an-web-editor/

## Running

The editor needs Web MIDI with SysEx access:

- **Chrome or Edge**: open `index.html` directly, or serve the folder (below).
- **Firefox** (113 or later) should also work, but only from a served page (not
  `file://`), and it asks you to install a site permission add-on to grant MIDI access.
  Not tested.
- **Safari** has no Web MIDI and is not supported.

To serve the folder: `python3 -m http.server 8150`, then open http://localhost:8150

Click **Enable MIDI** and allow SysEx access. Then pick the MIDI Out port connected to the host
synth, the Device ID (must match the Device Number set on the host synth), the keyboard
channel (the host synth's receive channel for the PLG150-AN part) and the PLG Part (used by
the Native Part messages).

## Using it

- **Voices**: pick a bank and click a voice button. The voice grid shows two rows (scroll for
  the rest); the **▼ All voices** handle under it shows all 128, **▲ 2 rows** makes it small
  again. **Store…** then a voice button stores the edit buffer in the bank; **Compare** switches
  between the edited and the stored voice (changed controls blink, Free EG tracks included).
- **Knobs**: drag up/down (Shift for fine steps), use the arrow keys / Page Up / Page Down after
  clicking one, or click the value under it and type a new one (e.g. `-6 dB`, `5k`, `C3`,
  `Thru`). Double-click resets a knob to its default.
- **Lamp lists** (waves, sources, modes): the button steps through the options, or click an
  option. Where a lamp stands for a group (the LFO shapes, LFO2 Phase/Fast), clicking the lit
  lamp steps through its variants.
- While a voice, bank or native settings are being sent, the page shows a wait cursor and
  ignores clicks and keys (Send Bank's Stop button and Esc still work).

## Tabs

- **Voice**: the main control panel, laid out on one grid like the AN Expert Editor (PEG,
  Control Matrix and Free EG summaries, Pattern Generator, LFO 1/2, VCF/FEG, Sync, FM, Mixer,
  VCO 1/2, VCA/AEG, Common/Portamento with category, voice name and MORPH, Distortion/EQ).
  Each LFO depth knob sits in the LFO it is assigned to; the other LFO shows a "→ VCO1"-style
  button in the same cell to move it there. The PEG, FEG and AEG graphs show the measured
  envelope shapes and times (see *Envelope times*).
- **Detail**: name, category, unison detune, portamento mode, LFO assign group, sync/FM
  details, distortion and EQ.
- **Control Matrix**: the 15 controller-to-parameter routings and the pitch bend range.
- **Free EG**: draw the four 192-point tracks, with line and shape tools, and copy/paste tracks.
- **Pattern Generator**: arpeggio and step sequencer settings, and the 16-step pattern.
- **PLG150-AN Native**: system and part settings that are not stored in the voice.
- **MIDI Monitor**: log of every message sent.

## Messages sent

| Action | Message |
|---|---|
| Edit a voice parameter (Live edit on) | `F0 43 1n 5C 10 bb pp vv F7`, bb = 00 Common, 10 Scene, 0E Step Seq. Two-byte parameters send `MSB LSB`. |
| Edit the Free EG (Live edit on) | Current Voice Common bulk (the board only takes Free EG data as a bulk dump), 250 ms after you stop drawing |
| Send Voice / select a voice (Auto send) | Current Voice bulk dumps: Common (`10 00 00`, 1640 bytes), Scene (`10 10 00`, 122 bytes), Step Seq (`10 0E 00`, 70 bytes) |
| Send Bank | 128 User Voice bulk dumps (`20 mm 00`, 1832 bytes each) to the User bank (Bank MSB 36, LSB 2, programs 1–128). Click again to stop. |
| Store with **Store → PLG** checked | one User Voice bulk dump to the same user voice number |
| Native tab | `F0 43 1n 5C 00 08 xx vv F7` (PLG150-AN system), `00 00 xx` (AN1x system controller numbers), `09 0p xx` (native part p) |
| MORPH button | `F0 43 1n 5C 00 08 04 vv F7` (Morph Ctrl: the last used controller, or 00 = off). Not stored in the voice. |
| Keyboard / wheels | Note on/off, pitch bend, CC1, CC64 on the keyboard channel |
| Panic | CC120 (All Sound Off), CC123 (All Notes Off), CC121 (Reset Controllers) |

## On the host synth

- The Current Voice data is what you hear while you edit. It is lost when you select another
  voice on the host synth itself. Use **Send Bank** (or **Store → PLG**) to put voices into the
  board's user memory: the **User bank, Bank MSB 36 / LSB 2**, programs 1–128. Sending the bank
  doesn't change the voice that is playing; select that bank and program on the part to hear
  the new voices. Per the Expert Editor manual, the board's user voices are lost when
  the host synth is switched off; keep them with the host's own storage (e.g. a memory card).
- The board can't send its data back, so the editor works from its own copy: the built-in
  banks and `.syx` files you open. No MIDI input is used.

## Banks

- **Preset 1** and **Preset 2**: the PLG150-AN preset voices.
- **User**: the default user bank of the C-PLG150-AN editor.

These banks were taken from the voice tables of the
[C-PLG150-AN](https://sourceforge.net/projects/c-plg150-an/) Ctrlr panel, which stores each
voice as a User Voice bulk dump. They are embedded in `js/presets.js` (gzip + base64), so the
editor also works when opened from disk.

Banks you change, open or create are kept in the browser's localStorage. Use **Save .syx** to
keep them as files (128 User Voice bulk dumps). **Export** saves the current voice as a
single-voice file (Current Voice Common + Scene + Step Seq bulk dumps). **Open .syx…** reads
either kind of file, and any file that contains these native bulk dumps. AN1x voice dumps
are not supported.

## Envelope times

Neither Yamaha manual gives envelope times; the parameters are plain 0–127 values. The times
shown on the envelope graphs, on the LCD and in the knob tooltips come from measurements of
a PLG150-AN (recorded through a MOTU 16A at 48 kHz, 1 Nov 2026), stored in `js/envmodel.js`:

- **One rate table for all stages.** At the same value, AEG decay/release, FEG decay/release
  and PEG attack/decay have the same time constant τ (within about 5–10 %): from 0.3 ms at 0 to
  9.8 s at 127, about ×1.75 per 8 steps over most of the range.
- **Decays and releases are exponential** (straight lines in dB for the AEG, fit within
  ~0.5 dB). The graphs label them with the time to 99 % of the way (≈ 4.6 τ; −40 dB for the
  AEG). Decays approach the sustain level with the same τ.
- **Attacks are near-linear rises**: the AEG reaches full level after 0.93 τ (slightly rounded),
  the FEG after 1.04 τ and the PEG after about 1.06 τ, from a fraction of a millisecond at 0 to
  ~10 s at 127. They are very repeatable: at the lowest values, 12 repeats agree within ~0.01 ms
  (AEG). The FEG starts within ~0.5 ms of the sound (a little jitter, up to ~3 ms, at values 0–8).
  A short click (~7–10 % of full level) precedes the AEG rise at note-on.
- **PEG Decay 127 holds** the depth; in that mode the PEG attack approaches the depth
  exponentially instead.
- **Sustain levels:** AEG sustain is not linear in amplitude (64 is −10.4 dB, 32 is −20 dB);
  FEG sustain is close to linear in the cutoff sweep.

Accuracy: the lowest attack values (0–24) were measured as 10–90 % rise times on sine test
tones, 12 repeats each; the model matches them within ~5 % (AEG, FEG) or within the ~0.5 ms the
pitch measurement cannot see after note-on (PEG). Other values 0–40 were measured at sample
level, the rest with RMS/pitch/filter tracking at 1–5 ms steps; the model is within ~5 % there.
Measured with an Init Voice base and C3/C6/C7 notes; key tracking or velocity settings may
change the times on the instrument.

## Files

- `index.html`, `css/style.css`: the UI
- `favicon.ico`, `icons/`: the page icons (16–512 px PNG renders)
- `js/an.js`: voice model, parameter map, formatting and `.syx` parsing
- `js/midi.js`: Web MIDI and SysEx builders
- `js/graphics.js`: knobs, envelope graphs and the 7-segment LED
- `js/envmodel.js`: the measured envelope timing model (generated)
- `js/app.js`: the app
- `js/presets.js`: the embedded banks (generated)

## Changelog

- 1/Nov/2026: First version of the editor.
- 3/Nov/2026: New UI Scaling option in the top bar. Fixed keeps the usual sizes; Auto makes the Voice page controls grow with the window width (on windows wider than about 1300px).
- 3/Nov/2026: Voice page layout uses the space better: the Pattern Gen. block has a second row (Kbd Mode, Subdivide, Velocity, Gate, Swing), the VCA block shows Volume and Velocity beside the AEG knobs under the graph, and the FEG graph fits the height of the LFO blocks.
