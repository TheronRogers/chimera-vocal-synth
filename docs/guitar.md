# Guitar: first string

Guitar mode adds an independent Rust `GuitarVoice` to the existing AudioWorklet. Its
648 mm string is tuned to E2 (82.41 Hz), with a nominal linear density of 0.006 kg/m;
tension follows from wave speed `c = 2 L f = sqrt(T / density)`. No samples or oscillators
supply its sound. This first version is a bare velocity pickup, without an acoustic body.

The solver advances transverse displacement in metres on 256 intervals, with fixed
nut and bridge boundaries. Its internal timestep keeps the Courant number at or below
0.8. Linear damping removes energy. The first equal-tempered fret is approximated by
the nearest grid node (14): the resulting F2 is about 2.6 cents flat, within the tested
10-cent tolerance. Fully pressed contact pins that node; lighter contact dissipates
energy there. Contact strength and the plucking finger's displacement approach their
targets over a few milliseconds. Pull is limited to ±4 mm.

The plucking finger constrains a node between 15% and 95% of the string length. Releasing
removes that constraint. The Pluck button and Space apply a 25 ms pull/release gesture on
the audio clock. A velocity pickup at node 221 supplies audio through a DC blocker and
bounded output gain. Displacement snapshots and a peak envelope drive the drawing at
18 pixels/mm; the audible-frequency motion is undersampled by the display, so the envelope
shows ongoing vibration even when the instantaneous snapshot looks nearly still.

## Playing

- Select Guitar and start audio, or use a guitar control to start it.
- Hold F or toggle Hold fret; drag the right finger away from the string and release.
- On touchscreens, hold the left finger while pulling with a second touch on the right.
  Drag the left finger downward to reduce pressure for a light damping touch.
- Space or Pluck performs a repeatable pluck. Mute clears vibration and both contacts.
- Pointer cancellation, lost capture, window blur, and hiding the page release contacts.
  Switching modes clears the guitar; entering Guitar stops voice, call, and beat playback.

The hand outlines are controls, separate from the solver. This version models one transverse
polarization and a simple dissipative contact, rather than full finger biomechanics or fret
collision/buzz. More strings, frets, fingers, and acoustic-body coupling remain future work.

## Boundary and checks

The numeric `engine_guitar` ABI takes an operation and three scalar arguments:
0 activates/deactivates; 1 sets fret pressure; 2 sets pluck position, displacement and held
state; 3 releases; 4 performs the timed pluck; 5 mutes. Separate guitar telemetry contains
264 doubles: clock, RMS, fret pressure, held, pluck position, pull, peak envelope, and 257
displacements. The worklet copies these before another engine call. Gesture records are unchanged.

Rust tests cover tuning, decay, harmonics, damping, repeated contacts, invalid inputs,
and block-size independence. The wasm tests compare native and wasm audio byte for byte;
the ABI allocation test includes activation, contacts, rendering and telemetry. Browser e2e
checks cover initial audio startup, F/Space, mouse pull/release, simultaneous touches,
cancellation, blur, mute, mode switches, and desktop/phone layouts.
