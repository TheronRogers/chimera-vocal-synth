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
- The instrument and both hands are solid 3D geometry. Drag away from the bridge strings
  to orbit, wheel/pinch to zoom, Reset view to return, and Neck back to inspect thumb support.
  Pointer contacts use the scene’s projection and retain their original string until release.
- Chords are solved with fixed phalange lengths, bounded finger bends, a thumb chain behind
  the neck, and spatial string/finger clearance checks. Invalid custom edits stay visible as
  drafts with an explanation while the last playable chord remains applied. The physical
  model is a generic adult hand; rejection describes this rig’s limits. The fretting palm
  cups below the neck; unused fingers curl along the palm outside the treble edge. F uses
  one index barre across all six strings, bent at the knuckle with continuous flat distal pads. A two-bone
  shoulder/elbow solver follows the wrist with fixed 290/240 mm arm lengths. The elbow
  pole follows the metacarpal axis to limit wrist bend as the hand moves up the neck.
- Live grips take 100 ms on the audio clock; live strokes wait for the grip. The display
  interpolates fixed-length bone directions with clearance lift. Scheduled grips settle at
  their score deadline. Picking motion follows audio-clock strum telemetry.
- The Vibration checkbox displays physical soundboard modal displacement amplified ×12.
  This amplification changes the drawing only.

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

Each 648 mm string uses a transverse FDTD grid in a fixed-capacity 257-value buffer.
The active spatial resolution is chosen per string to keep all six strings, plate modes,
and cavity on the same conservative timestep (at least 96 kHz, with at least two substeps
per audio sample). UI telemetry resamples each physical grid to 257 positions. Fundamental
frequency compensation accounts for the grid’s fret rounding and numerical dispersion;
all 78 sustained string/fret pitches remain within 10 cents at 44.1 and 48 kHz.

Atomic grips supply normalized pressure. Quasi-static string action and tension determine
whether the preload reaches the rigid fret crown. A localized compliant pad supplies
implicit spring/damping forces around the static equilibrium; insufficient preload leaves
the string unstopped with that pad contact. This reduced contact model avoids injecting finger displacement
as pluck excitation. Held mutes remain independent of fretting and cannot pluck on release.

Excitation is a bounded 25 ms pull followed by release, performed internally by the solver.
The user never drags this displacement. A strum separates included strings by 8 ms; its
scheduled timestamp is the first included string's release into vibration. Chord events
and early strum preparation have separate cursors so a chord on the beat cannot delay a
strum. Score state is fixed-capacity (2048 events); invalid events are dropped and counted.
All playback timing is advanced by audio samples, not browser timers.

Bridge reaction drives sixteen mass-normalized soundboard modes, and their reciprocal
bridge motion drives string endpoints, including unplucked strings. A lumped cavity and
soundhole oscillator exchanges pressure work with plate volume displacement. The output
mixes plate/soundhole radiation with a direct string-velocity component. Physical modal
coordinates drive the displayed soundboard mesh; a scalar envelope never generates its motion.

`bun tools/gen-guitar-body.ts` (after `bun run wasm`) generates the spatial basis and
coefficients from the shared Rust outline using a 16-function Rayleigh–Ritz reduction on a
coarse orthotropic plate with a soundhole and X-brace stiffness. Generic spruce parameters:
density 430 kg/m³, thickness 2.8 mm, longitudinal modulus 10 GPa, transverse modulus 0.8 GPa,
and shear modulus 0.6 GPa. The cavity is 16 litres with an effective soundhole length of
85 mm. Bridge participation is reduced by 0.05 to represent the stiff distributed saddle;
mode damping is `3 + 0.025 × frequency` per second. These are design assumptions, not a fit
to a measured instrument. Back and sides are rigid. No samples or measured IRs are used.

The model retains one transverse polarization. Contact compliance is a localized linear spring/damper around static
preload rather than nonlinear soft tissue dynamics. Hand clearance is sampled,
and the renderer’s lifted interpolation is an approximation rather than a full swept-volume
biomechanical simulation. A mute may leave a coupled body/sympathetic tail; Stop All clears it.

## Boundary and checks

The numeric `engine_guitar` ABI is version 3: 0 activation, 1 string fret, 2 held string
mute, 3 string pluck, 4 directional strum, 5 stop, 6 guitar/singer levels, 7 atomic grip (six base-14 fret digits, normalized pressure). The fixed score
buffer contains up to 2048 records of 80 bytes: ten little-endian doubles for time, six
frets, direction, strength, and progression step. `engine_guitar_schedule` receives the
count, lead, duration, loop flag and BPM. The worklet schedules voice gestures and guitar
records in one message before rendering, with a common lead. Voice gesture records are unchanged.

Guitar telemetry is versioned and length-checked: 1648 doubles, a 64-value header and six
264-value string records. The header reports clock, RMS, transport, body envelope and strum
state, bridge/cavity displacement, transition phase, sixteen modal displacement/velocity pairs,
target frets, and contact forces. Each string reports fret, mute, excitation, position, pull, envelope, RMS and 257
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

### Verification of the 3D/coupled implementation

131 Rust tests and 40 Bun tests pass, including cold allocations and native/WASM byte
identity. Both intentional golden re-blesses pass. Production build and typecheck pass.
Chrome preview e2e covers projected contacts, invalid drafts, neck-back inspection, both
singer arrangements, transport cancellation and clock synchronization. Layout lint reports
zero errors in 256 views across eight viewport sizes; 20 pre-existing truncation warnings
remain in other screens. Native guitar-plus-singer cost measured 29.3% of one core versus
36.5% before this change on this machine. Browser contacts remain synthetic; no physical
touch hardware or measured-instrument listening comparison was performed.
