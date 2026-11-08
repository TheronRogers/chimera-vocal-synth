# Guitar: six strings and a singer

Guitar mode contains six physical strings in standard E2–A2–D3–G3–B3–E4 tuning,
a reduced acoustic body, a chord editor, and a sample-clock accompaniment player.
The optional singer shares its timeline and output. Sing mode remains voice-only.

## Playing

- Choose C, D, E, G, A, Am, Dm, Em, F, or Bm, or edit each string's open/fret 1–12/skip setting.
  F and Bm include a barre. Custom shapes show contacts that exceed four fretting fingers
  in amber; they still sound, without inventing extra fingers on the hand.
- Strum Down / Space sweeps low to high. Strum Up / Shift+Space sweeps high to low.
  Each string also has a Pluck button. Keyboard shortcuts ignore editable controls.
- Hold a string near the picking hand, or hold its Mute button with a pointer, Space,
  or Enter. The original string remains damped for that entire contact. Pointer motion
  does nothing. Releasing a contact does not pluck. Independent touches can mute several
  strings, and plucks/strums cannot override a held mute.
- Stop All cancels the score and excitation and fades strings and body to silence in 8 ms.
  Pointer cancellation, lost capture, blur, and page hiding release transient contacts.
- The drawings contain a thumb and four articulated fingers on each hand. The fretting
  hand follows the sounding chord; the picking hand follows audio-clock strum telemetry.
  The guitar faces the viewer as a right-handed player's instrument, with the neck on the
  right. Longer fretting reaches draw in front, with bent fingertips clear of other fingers.
  On phones, a neck-up portrait view keeps the full instrument visible.

## Accompaniment

The initial progression is C–G–Am–F, four beats each, at 84 BPM. The eight rhythm slots
represent `1 & 2 & 3 & 4 &`; each cycles down → up → rest. The default is
`D – D U – U D U`. Add/remove up to 32 chord steps, each 1–16 beats. Selecting
“Custom shape” copies the current manual chord into that step. Standalone playback loops.
Tempo, rhythm, and progression edits take effect on the next start. Live chord changes
and strums are immediate; the next scheduled event restores the progression's chord.

“With singer” exposes the existing face, lyrics, piano roll, body presets, and demo selector.
The singer sits beside the guitar on desktop; narrow screens stack the guitar and singer
above the chord and progression editors.
“Made of air” and “Twinkle, twinkle” each load an authored, editable arrangement. The singer's
0.35-second musical lead-in is preserved. Both parts use the selected tempo, and the
progression repeats or truncates to the melody's duration. It then stops scheduling strokes,
leaving a natural guitar tail. Stop/restart, song changes, singer-body changes, and leaving
Guitar cancel both parts. Settings persist in memory across mode changes, not across reloads.
Guitar and singer have separate levels before the existing master volume.

## Physical model

Each 648 mm string uses the existing fixed 256-interval transverse FDTD solver. Standard
pitches determine wave speed; a nominal 68.4 N tension gives differing linear densities.
The timestep retains a Courant number no greater than 0.8. Nearest-grid fret boundaries
cover the first twelve frets; all 78 string/fret combinations are tested within 10 cents
at 44.1 and 48 kHz. Fully fretted boundaries shorten the vibrating string. Skipped strings
and held mutes dissipate energy without displacement constraints that could pluck on release.

Excitation is a bounded 25 ms pull followed by release, performed internally by the solver.
The user never drags this displacement. A strum separates included strings by 8 ms; its
scheduled timestamp is the first included string's release into vibration. Chord events
and early strum preparation have separate cursors so a chord on the beat cannot delay a
strum. Score state is fixed-capacity (2048 events); invalid events are dropped and counted.
All playback timing is advanced by audio samples, not browser timers.

Summed bridge reaction forces drive eight damped second-order modes, combined with a small
velocity-pickup component. Coefficients are computed through `chimera::math`; the body is a
reduced resonance/radiation model, not a full soundboard mesh or bidirectional bridge coupling.
No samples or measured impulse responses are used. A per-string mute may leave a short body
tail; Stop All clears it. One transverse polarization, twelve frets, and animated hand poses
are the present scope; there is no independent finger posing or full hand biomechanics.

## Boundary and checks

The numeric `engine_guitar` ABI is version 2: 0 activation, 1 string fret, 2 held string
mute, 3 string pluck, 4 directional strum, 5 stop, 6 guitar/singer levels. The fixed score
buffer contains up to 2048 records of 80 bytes: ten little-endian doubles for time, six
frets, direction, strength, and progression step. `engine_guitar_schedule` receives the
count, lead, duration, loop flag and BPM. The worklet schedules voice gestures and guitar
records in one message before rendering, with a common lead. Voice gesture records are unchanged.

Guitar telemetry is versioned and length-checked: 1600 doubles, a 16-value header and six
264-value string records. The header reports clock, RMS, transport, body envelope and strum
state. Each string reports fret, mute, excitation, position, pull, envelope, RMS and 257
physical displacements. Human and guitar telemetry are both copied and retained. Geometry
snapshots and envelopes are drawing data; UI polling never determines audio timing.

Rust tests cover pitch, muting, decay, body stability, strum timing and order, score loops,
restart, invalid inputs, block-size independence, and unchanged voice-only rendering. The
wasm tests render the same six-string/body/human scenario natively and in wasm and require
byte-identical audio. The ABI allocation test includes score loading, playback, contacts,
and both voices. Browser e2e covers first-use startup, chords, keyboard controls, independent
touches, drag/release silence, cancellation, both singer demos, clock synchronization,
mode/body changes, and combined load below 70%. Layout lint covers eight viewport sizes.

Run `bun run test`, `bun run typecheck`, `bun run build`, preview/e2e, and `bun run lint:layout`.
For intentional audio changes, re-bless twice as described in the golden README, then run
normal verification. `cargo run --release -q -p chimera --example bench` reports voice-only
and six-string-plus-singer cost. Browser touch tests use synthetic events, not physical hardware.
