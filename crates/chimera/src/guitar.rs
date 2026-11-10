//! Six transverse strings and a reduced acoustic-body model, with bounded audio-clock events.
//! Fixed grids retain real displacement/contact state; no samples, oscillators or I/O.
use crate::math;
pub mod body;
pub mod geometry;
pub mod instrument;

pub const STRING_COUNT: usize = 6;
pub const N: usize = 256;
pub const GUITAR_LAYOUT_VERSION: u32 = 6;
pub const TELE_HEADER: usize = 70;
pub const STRING_TELE_LEN: usize = 7 + N + 1;
pub const TELE_LEN: usize = TELE_HEADER + STRING_COUNT * STRING_TELE_LEN;
pub const CAPACITY: usize = 2048;
pub const LENGTH: f64 = 0.648;
pub const BASS_OPEN_MIDI: [u8; 4] = [28, 33, 38, 43];
pub const OPEN_MIDI: [u8; STRING_COUNT] = [40, 45, 50, 55, 59, 64];
const PULL_SECONDS: f64 = 0.025;
const STRUM_SECONDS: f64 = 0.008;
const NO_EVENT: u64 = u64::MAX;

#[derive(Clone, Copy, Debug)]
pub struct GuitarEvent {
    /// Audible first-string release, in seconds relative to the score start.
    pub time: f64,
    pub frets: [i8; STRING_COUNT],
    /// +1 low to high, -1 high to low, 0 changes the chord, 2 through 7 pluck strings 0 through 5.
    pub direction: i8,
    pub strength: f64,
    pub step: u16,
}
impl Default for GuitarEvent {
    fn default() -> Self {
        Self {
            time: 0.0,
            frets: [0; STRING_COUNT],
            direction: 0,
            strength: 0.0,
            step: 0,
        }
    }
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum Pickup {
    #[default]
    Acoustic,
    SingleCoil,
    Humbucker,
}

#[derive(Default)]
struct PickupCircuit {
    b: [f64; 3],
    a: [f64; 2],
    state: [f64; 2],
}

impl PickupCircuit {
    fn new(pickup: Pickup, fs: f64) -> Self {
        // Loaded RLC response. Higher series inductance lowers the humbucker resonance.
        let (hz, q, gain) = match pickup {
            Pickup::Acoustic => return Self::default(),
            Pickup::SingleCoil => (4300.0_f64, 1.35, 0.38),
            Pickup::Humbucker => (2700.0_f64, 0.95, 0.54),
        };
        let phase = math::TAU * hz.min(fs * 0.4) / fs;
        let cos = math::cos(phase);
        let alpha = math::sin(phase) / (2.0 * q);
        let b = gain * (1.0 - cos) / (2.0 * (1.0 + alpha));
        Self {
            b: [b, 2.0 * b, b],
            a: [-2.0 * cos / (1.0 + alpha), (1.0 - alpha) / (1.0 + alpha)],
            state: [0.0; 2],
        }
    }

    fn step(&mut self, input: f64) -> f64 {
        let out = self.b[0] * input + self.state[0];
        self.state[0] = self.b[1] * input - self.a[0] * out + self.state[1];
        self.state[1] = self.b[2] * input - self.a[1] * out;
        out
    }
}

struct StringVoice {
    y: [f64; N + 1],
    prev: [f64; N + 1],
    next: [f64; N + 1],
    sub: usize,
    n: usize,
    speed: f64,
    dt: f64,
    lambda2: f64,

    damping: f64,
    damping_inverse: f64,
    velocity_diffusion: f64,
    mute_decay: f64,
    pull_rate: f64,
    tension: f64,
    fret: i8,
    boundary: usize,
    held: bool,
    pressure: f64,
    pad_position: usize,
    pad_omega2: f64,
    pad_gamma: f64,
    active: bool,
    contact: bool,
    position: usize,
    pickup_position: usize,
    magnetic_taps: [f64; 2],
    pluck_position: f64,
    pull: f64,
    target: f64,
    prepare: u64,
    release: u64,
    stroke_release: u64,
    envelope: f64,
    dc_x: f64,
    dc_y: f64,
    sum: f64,
}
impl StringVoice {
    fn new(fs: f64, midi: u8, index: usize) -> Self {
        let speed = 2.0 * LENGTH * math::midi_to_hz(midi as f64);
        let sub = (96000.0 / fs).ceil().max(2.0) as usize;
        let n = ((0.7 * fs * sub as f64 * LENGTH / speed).floor() as usize).clamp(32, N);
        let dt = 1.0 / (fs * sub as f64);
        let profile = &instrument::STRINGS[0];
        let mut string = Self {
            y: [0.0; N + 1],
            prev: [0.0; N + 1],
            next: [0.0; N + 1],
            sub,
            n,
            speed,
            dt,
            lambda2: (math::sin(math::PI * speed * dt / (2.0 * LENGTH))
                / math::sin(math::PI / (2.0 * n as f64)))
            .powi(2),

            damping: 0.0,
            damping_inverse: 1.0,
            velocity_diffusion: 0.0,
            mute_decay: math::exp(-dt / 0.006),
            pull_rate: (dt / 0.003).min(1.0),
            tension: profile.tension[index],
            fret: 0,
            boundary: 0,
            held: false,
            pressure: 1.0,
            pad_position: 0,
            pad_omega2: 0.0,
            pad_gamma: 0.0,
            active: false,
            contact: false,
            position: (n as f64 * 0.8).round() as usize,
            pickup_position: (n as f64 * 0.863).round() as usize,
            magnetic_taps: [0.0; 2],
            pluck_position: 0.8,
            pull: 0.0,
            target: 0.0,
            prepare: NO_EVENT,
            release: NO_EVENT,
            stroke_release: NO_EVENT,
            envelope: 0.0,
            dc_x: 0.0,
            dc_y: 0.0,
            sum: 0.0,
        };
        string.set_losses(profile.loss, profile.overtone_loss(index));
        string
    }
    fn set_losses(&mut self, loss: f64, overtone_loss: f64) {
        self.damping = loss * self.dt;
        self.damping_inverse = 1.0 / (1.0 + self.damping);
        // A spatial Laplacian of velocity damps short wavelengths more strongly.
        // At 2 kHz the continuous decay rate is ν/2 × (2πf/c)².
        let phase = math::TAU * 2000.0 * (LENGTH / self.n as f64) / self.speed;
        let diffusion = 2.0 * overtone_loss * self.dt / (phase * phase);
        // Keep λ² + 2d below one for the fretted grid as well.
        self.velocity_diffusion = diffusion.min(0.08);
    }
    fn set_fret(&mut self, fret: i8) {
        let fret = fret.clamp(-1, 12);
        if self.fret == fret {
            return;
        }
        self.fret = fret;
        self.boundary = if self.fret > 0 {
            (self.n as f64 * (1.0 - math::pow(2.0, -(self.fret as f64) / 12.0))).round() as usize
        } else {
            0
        };
        let frequency =
            self.speed / (2.0 * LENGTH) * math::pow(2.0, self.fret.max(0) as f64 / 12.0);
        self.lambda2 = (math::sin(math::PI * frequency * self.dt)
            / math::sin(math::PI / (2.0 * (self.n - self.boundary) as f64)))
        .powi(2);
        self.y[..=self.boundary].fill(0.0);
        self.prev[..=self.boundary].fill(0.0);
        self.next[..=self.boundary].fill(0.0);
        if self.fret < 0 {
            self.cancel_contact();
        }
    }
    fn cancel_contact(&mut self) {
        self.contact = false;
        self.prepare = NO_EVENT;
        self.release = NO_EVENT;
        self.stroke_release = NO_EVENT;
    }
    fn reset(&mut self) {
        self.y.fill(0.0);
        self.prev.fill(0.0);
        self.next.fill(0.0);
        self.cancel_contact();
        self.active = false;
        self.pull = 0.0;
        self.target = 0.0;
        self.envelope = 0.0;
        self.dc_x = 0.0;
        self.dc_y = 0.0;
        self.sum = 0.0;
    }
    fn schedule(&mut self, release: u64, pull_samples: u64, strength: f64, position: f64) {
        self.pluck_position = position;
        self.stroke_release = NO_EVENT;
        self.target = 0.0025 * strength;
        self.prepare = release.saturating_sub(pull_samples);
        self.release = release;
    }
    fn sense(&self, pickup: Pickup) -> f64 {
        if pickup == Pickup::Acoustic {
            return self.y[self.pickup_position];
        }
        let sample = |x: f64| {
            let i = x as usize;
            self.y[i] + (self.y[i + 1] - self.y[i]) * (x - i as f64)
        };
        let first = sample(self.magnetic_taps[0]);
        if pickup == Pickup::Humbucker {
            // Opposite magnetic polarity and winding make string signals add.
            // The separated coils average different points of the standing wave.
            0.5 * (first + sample(self.magnetic_taps[1]))
        } else {
            first
        }
    }

    fn tick(&mut self, clock: u64, fs: f64, bridge: f64, pickup: Pickup) -> (f64, f64) {
        if self.prepare != NO_EVENT && clock >= self.prepare {
            self.prepare = NO_EVENT;
            self.contact = true;
            self.active = true;
            self.position = ((self.n as f64 * self.pluck_position).round() as usize)
                .clamp(self.boundary + 1, self.n - 1);
            self.pull = self.y[self.position];
        }
        if self.release != NO_EVENT && clock >= self.release {
            self.release = NO_EVENT;
            self.contact = false;
        }
        if !self.active && bridge.abs() > 1e-15 && !self.held && self.fret >= 0 {
            self.active = true;
        }
        if !self.active {
            return (0.0, 0.0);
        }
        let before = self.sense(pickup);
        let muted = self.held || self.fret < 0;
        self.y[self.n] = if muted { 0.0 } else { bridge };
        let force = self.tension * (self.y[self.n - 1] - self.y[self.n]) / (LENGTH / self.n as f64);
        {
            self.next[self.n] = if muted { 0.0 } else { bridge };
            let diffusion = self.velocity_diffusion;
            let current_lap = self.lambda2 + diffusion;
            let current_center = (2.0 - 2.0 * current_lap) * self.damping_inverse;
            let current_edge = current_lap * self.damping_inverse;
            let previous_center = (2.0 * diffusion - (1.0 - self.damping)) * self.damping_inverse;
            let previous_edge = -diffusion * self.damping_inverse;
            let current = self.y[self.boundary..=self.n].windows(3);
            let previous = self.prev[self.boundary..=self.n].windows(3);
            for ((next, y), old) in self.next[self.boundary + 1..self.n]
                .iter_mut()
                .zip(current)
                .zip(previous)
            {
                *next = current_center * y[1]
                    + current_edge * (y[0] + y[2])
                    + previous_center * old[1]
                    + previous_edge * (old[0] + old[2]);
            }
            if self.pad_position > self.boundary
                && self.pad_position < self.n
                && self.pad_omega2 > 0.0
            {
                let i = self.pad_position;
                let stiffness = 0.5 * self.pad_omega2 * self.dt * self.dt;
                let loss = self.pad_gamma * self.dt;
                self.next[i] =
                    (self.next[i] + (loss - stiffness) * self.prev[i]) / (1.0 + loss + stiffness);
            }
            if self.contact {
                self.pull += (self.target - self.pull) * self.pull_rate;
                self.next[self.position] = self.pull;
            }
            if muted {
                for i in self.boundary + 1..self.n {
                    self.next[i] *= self.mute_decay;
                    self.y[i] *= self.mute_decay;
                }
            }
            core::mem::swap(&mut self.prev, &mut self.y);
            core::mem::swap(&mut self.y, &mut self.next);
        }
        // The drawing's peak hold needs a few-kHz scan, not six full grid scans per audio
        // sample. Absolute sample phase keeps telemetry/render block sizes irrelevant.
        self.envelope *= 0.9995;
        if clock % 8 == 0 {
            let peak = self.y[self.boundary + 1..self.n]
                .iter()
                .fold(0.0f64, |p, x| p.max(x.abs()));
            self.envelope = self.envelope.max(peak);
        }
        let pickup = (self.sense(pickup) - before) * fs * 0.15;
        let highpass = pickup - self.dc_x + 0.995 * self.dc_y;
        self.dc_x = pickup;
        self.dc_y = highpass;
        // Pull preparation is mechanical state, not an early audible onset.
        let audio = if self.contact { 0.0 } else { highpass };
        let force = if self.contact || muted { 0.0 } else { force };
        self.sum += audio * audio;
        if self.envelope < 1e-12
            && bridge.abs() < 1e-15
            && !self.contact
            && self.release == NO_EVENT
        {
            self.reset();
        }
        (audio, force)
    }
}

pub struct GuitarVoice {
    pickup: Pickup,
    magnetic_position: f64,
    pickup_circuit: PickupCircuit,
    strum_position: f64,
    body_profile: usize,
    string_profile: usize,
    bass: bool,
    strings: [StringVoice; STRING_COUNT],
    body: body::Body,
    fs: f64,
    clock: u64,
    pull_samples: u64,
    spacing: u64,
    score: [GuitarEvent; CAPACITY],
    score_len: usize,
    cursor: usize,
    cycle: u64,
    chord_cursor: usize,
    chord_cycle: u64,
    fret_event: u64,
    start: u64,
    duration: u64,
    looping: bool,
    playing: bool,
    bpm: f64,
    dropped: usize,
    last_direction: i8,
    last_strum: f64,
    fade: usize,
    fade_length: usize,
    sum: f64,
    count: usize,
    body_envelope: f64,
    pickup_low: f64,
    pickup_low_step: f64,
    grip_at: u64,
    grip_start: u64,
    grip_target: [i8; 6],
    grip_pressure: f64,
}
impl GuitarVoice {
    pub fn new(fs: f64) -> Self {
        let fs = if fs.is_finite() && fs >= 8000.0 {
            fs
        } else {
            48000.0
        };
        Self {
            pickup: Pickup::Acoustic,
            magnetic_position: 0.86,
            pickup_circuit: PickupCircuit::default(),
            strum_position: 0.8,
            body_profile: 0,
            string_profile: 0,
            bass: false,
            strings: core::array::from_fn(|i| StringVoice::new(fs, OPEN_MIDI[i], i)),
            body: body::Body::new(1.0 / (fs * (96000.0 / fs).ceil().max(2.0))),
            fs,
            clock: 0,
            pull_samples: (fs * PULL_SECONDS).round() as u64,
            spacing: (fs * STRUM_SECONDS).round() as u64,
            score: [GuitarEvent::default(); CAPACITY],
            score_len: 0,
            cursor: 0,
            cycle: 0,
            chord_cursor: 0,
            chord_cycle: 0,
            fret_event: 0,
            start: 0,
            duration: 1,
            looping: false,
            playing: false,
            bpm: 96.0,
            dropped: 0,
            last_direction: 0,
            last_strum: -1.0,
            fade: 0,
            fade_length: (fs * 0.008) as usize,
            sum: 0.0,
            count: 0,
            body_envelope: 0.0,
            pickup_low: 0.0,
            pickup_low_step: 1.0 - math::exp(-math::TAU * 1200.0 / fs),
            grip_at: 0,
            grip_start: 0,
            grip_target: [0; 6],
            grip_pressure: 1.0,
        }
    }
    /// Switch between standard guitar and four-string bass without reallocating.
    pub fn set_bass(&mut self, bass: bool) {
        if self.bass == bass {
            return;
        }
        self.hard_reset();
        self.bass = bass;
        let profile = &instrument::STRINGS[self.string_profile];
        let position = self.magnetic_position;
        let half_spacing = if self.pickup == Pickup::Humbucker { 0.009 / LENGTH } else { 0.0 };
        for (i, string) in self.strings.iter_mut().enumerate() {
            let midi = if bass { BASS_OPEN_MIDI.get(i).copied().unwrap_or(OPEN_MIDI[i]) } else { OPEN_MIDI[i] };
            *string = StringVoice::new(self.fs, midi, i);
            string.tension = profile.tension[i];
            string.set_losses(profile.loss, profile.overtone_loss(i));
            string.magnetic_taps = [
                (position - half_spacing) * string.n as f64,
                (position + half_spacing) * string.n as f64,
            ];
            if bass && i >= BASS_OPEN_MIDI.len() {
                string.set_fret(-1);
            }
        }
        self.grip_target = core::array::from_fn(|i| self.strings[i].fret);
    }

    /// Reconfigure at a command boundary without allocating or changing tuning.
    pub fn set_instrument(&mut self, body: usize, strings: usize) {
        let (Some(body_model), Some(string_model)) = (
            instrument::BODIES.get(body),
            instrument::STRINGS.get(strings),
        ) else {
            return;
        };
        if (body, strings) == (self.body_profile, self.string_profile) {
            return;
        }
        let frets = if self.grip_at > 0 {
            self.grip_target
        } else {
            core::array::from_fn(|i| self.strings[i].fret)
        };
        self.playing = false;
        self.score_len = 0;
        self.clear_sound();
        self.last_direction = 0;
        self.last_strum = -1.0;
        self.body_profile = body;
        self.string_profile = strings;
        self.body.set_profile(body_model);
        for (i, string) in self.strings.iter_mut().enumerate() {
            string.tension = string_model.tension[i];
            string.set_losses(string_model.loss, string_model.overtone_loss(i));
        }
        self.grip_target = frets;
        self.grip_start = self.clock;
        self.grip_at = self.clock.max(1);
        self.grip_tick();
    }
    /// Position runs from the nut (0) to the bridge (1) on the full scale.
    pub fn set_strum_position(&mut self, position: f64) {
        if position.is_finite() {
            self.strum_position = position.clamp(0.72, 0.96);
        }
    }

    pub fn set_pickup(&mut self, pickup: Pickup, position: f64) {
        if !position.is_finite() {
            return;
        }
        let position = position.clamp(0.72, 0.96);
        if self.pickup != pickup {
            self.pickup_circuit = PickupCircuit::new(pickup, self.fs);
            self.body.clear();
        } else if self.magnetic_position == position {
            return;
        }
        self.pickup = pickup;
        self.magnetic_position = position;
        let half_spacing = if pickup == Pickup::Humbucker {
            0.009 / LENGTH
        } else {
            0.0
        };
        for string in &mut self.strings {
            string.magnetic_taps = [
                (position - half_spacing) * string.n as f64,
                (position + half_spacing) * string.n as f64,
            ];
        }
    }

    pub fn clock(&self) -> f64 {
        self.clock as f64 / self.fs
    }
    pub fn set_fret(&mut self, index: usize, fret: i8) {
        if let Some(s) = self.strings.get_mut(index) {
            s.set_fret(if self.bass && index >= BASS_OPEN_MIDI.len() { -1 } else { fret });
        }
    }
    /// Atomic clean grip: pressure is normalized preload; low pressure dissipates
    /// rather than imposing a new hard fret boundary.
    pub fn set_shape(&mut self, frets: [i8; 6], pressure: f64) {
        self.grip_pressure = strength_value(pressure);
        self.set_shape_at(frets, self.clock + (self.fs * 0.1).round() as u64);
    }
    fn set_shape_at(&mut self, mut frets: [i8; 6], deadline: u64) {
        if self.bass {
            frets[BASS_OPEN_MIDI.len()..].fill(-1);
        }
        if self.grip_target == frets
            && self
                .strings
                .iter()
                .zip(frets)
                .all(|(s, f)| s.pressure == if f > 0 { self.grip_pressure } else { 0.0 })
        {
            return;
        }
        self.grip_target = frets;
        self.grip_start = self.clock;
        self.grip_at = deadline.max(self.clock);
    }
    fn grip_tick(&mut self) {
        if self.grip_at > 0 && self.clock >= self.grip_at {
            for (s, f) in self.strings.iter_mut().zip(self.grip_target) {
                s.pressure = if f > 0 { self.grip_pressure } else { 0.0 };
                let x = geometry::fret_x(f.max(1));
                let action = 0.0008 + 0.0012 * x / LENGTH;
                let required = s.tension * action * (1.0 / x + 1.0 / (LENGTH - x));
                let ratio = if f > 0 {
                    (3.0 * s.pressure / required).min(1.0)
                } else {
                    0.0
                };
                s.pad_position = (((x - 0.006).max(0.0) / LENGTH) * s.n as f64).round() as usize;
                let mass = s.tension / (s.speed * s.speed) * LENGTH / s.n as f64;
                s.pad_omega2 = 1000.0 * ratio / mass;
                s.pad_gamma = 0.4 * s.pad_omega2.sqrt();
                s.set_fret(if f > 0 && 3.0 * s.pressure < required {
                    0
                } else {
                    f
                });
            }
            self.grip_at = 0;
        }
    }
    pub fn set_mute(&mut self, index: usize, held: bool) {
        if let Some(s) = self.strings.get_mut(index) {
            s.held = held;
            if held {
                s.cancel_contact();
            }
        }
    }
    pub fn pluck(&mut self, index: usize, strength: f64) {
        let strength = strength_value(strength);
        if strength == 0.0 {
            return;
        }
        if let Some(s) = self.strings.get_mut(index) {
            let fret = if self.grip_at > 0 {
                self.grip_target[index]
            } else {
                s.fret
            };
            if s.held || fret < 0 {
                return;
            }
            self.fade = 0;
            let release = self.clock.max(self.grip_at) + self.pull_samples;
            self.schedule_pick(index, release, strength);
        }
    }
    fn schedule_pick(&mut self, index: usize, release: u64, strength: f64) {
        self.last_direction = 0;
        self.last_strum = -1.0;
        for string in &mut self.strings {
            if string.stroke_release != release {
                string.stroke_release = NO_EVENT;
            }
        }
        let string = &mut self.strings[index];
        string.schedule(release, self.pull_samples, strength, self.strum_position);
        string.stroke_release = release;
    }
    pub fn strum(&mut self, direction: i8, strength: f64) {
        let strength = strength_value(strength);
        if direction == 0 || strength == 0.0 {
            return;
        }
        self.fade = 0;
        self.schedule_strum(
            self.clock.max(self.grip_at) + self.pull_samples,
            direction,
            strength,
        );
    }
    fn schedule_strum(&mut self, release: u64, direction: i8, strength: f64) {
        if direction == 0 || strength <= 0.0 {
            return;
        }
        for string in &mut self.strings {
            string.stroke_release = NO_EVENT;
        }
        self.last_direction = if direction > 0 { 1 } else { -1 };
        self.last_strum = release as f64 / self.fs;
        let mut onset = 0;
        for order in 0..STRING_COUNT {
            let index = if direction > 0 {
                order
            } else {
                STRING_COUNT - 1 - order
            };
            if (if self.grip_at > 0 {
                self.grip_target[index]
            } else {
                self.strings[index].fret
            }) < 0
                || self.strings[index].held
            {
                continue;
            }
            let string = &mut self.strings[index];
            let deadline = release.saturating_add(onset * self.spacing);
            string.schedule(deadline, self.pull_samples, strength, self.strum_position);
            string.stroke_release = deadline;
            onset += 1;
        }
    }
    /// Copy a bounded, time-ordered score. Invalid times are rejected; overflow is counted.
    pub fn load_score(
        &mut self,
        events: &[GuitarEvent],
        start: f64,
        duration: f64,
        looping: bool,
        bpm: f64,
    ) {
        self.playing = false;
        self.score_len = 0;
        self.dropped = 0;
        self.cursor = 0;
        self.cycle = 0;
        self.chord_cursor = 0;
        self.chord_cycle = 0;
        self.fret_event = 0;
        for s in &mut self.strings {
            s.cancel_contact();
        }
        if !start.is_finite() || !duration.is_finite() || duration <= 0.0 {
            return;
        }
        self.start = (start.max(0.0) * self.fs).round() as u64;
        self.duration = ((duration * self.fs).round() as u64).max(1);
        self.looping = looping;
        self.bpm = if bpm.is_finite() {
            bpm.clamp(20.0, 300.0)
        } else {
            96.0
        };
        let mut previous = -1.0;
        for event in events {
            if !event.time.is_finite()
                || event.time < previous
                || event.time < 0.0
                || event.time >= duration
                || self.score_len == CAPACITY
            {
                self.dropped += 1;
                continue;
            }
            let mut event = *event;
            event.frets = event.frets.map(|f| f.clamp(-1, 12));
            if self.bass {
                event.frets[BASS_OPEN_MIDI.len()..].fill(-1);
            }
            event.strength = strength_value(event.strength);
            if !(-1..=7).contains(&event.direction) {
                event.direction = 0;
            }
            previous = event.time;
            self.score[self.score_len] = event;
            self.score_len += 1;
        }
        // A queued restart normally leaves room for the previous Stop fade. If its
        // preparation is immediate, clear the old sound before accepting new contacts.
        if self.fade > 0
            && self.start.saturating_sub(self.pull_samples)
                < self.clock.saturating_add(self.fade as u64)
        {
            self.clear_sound();
        }
        self.cursor = self.find_event(0, true);
        self.chord_cursor = self.find_event(0, false);
        self.playing = self.score_len > 0;
    }
    /// Cancel transport and finish a short sample-clock fade, retaining the selected chord.
    pub fn stop(&mut self) {
        self.playing = false;
        self.score_len = 0;
        for s in &mut self.strings {
            s.cancel_contact();
        }
        self.fade = self.fade_length.max(1);
    }
    /// Immediate reset for engine teardown/mode changes. The clock never rewinds.
    pub fn hard_reset(&mut self) {
        self.playing = false;
        self.score_len = 0;
        self.clear_sound();
        for s in &mut self.strings {
            s.held = false;
        }
        self.last_direction = 0;
        self.last_strum = -1.0;
    }
    fn clear_sound(&mut self) {
        self.grip_at = 0;
        self.grip_target = core::array::from_fn(|i| self.strings[i].fret);
        self.fade = 0;
        for s in &mut self.strings {
            s.reset();
        }
        self.body.clear();
        self.sum = 0.0;
        self.count = 0;
        self.body_envelope = 0.0;
        self.pickup_low = 0.0;
        self.pickup_circuit.state = [0.0; 2];
    }
    fn find_event(&self, from: usize, strum: bool) -> usize {
        self.score[from..self.score_len]
            .iter()
            .position(|e| (e.direction != 0) == strum)
            .map_or(self.score_len, |i| from + i)
    }
    fn event_deadline(&self, cursor: usize, cycle: u64, _strum: bool) -> (u64, u64) {
        if cursor == self.score_len {
            return (NO_EVENT, NO_EVENT);
        }
        let release = self
            .start
            .saturating_add(cycle)
            .saturating_add((self.score[cursor].time * self.fs).round() as u64);
        (
            release.saturating_sub(self.pull_samples.max((self.fs * 0.1).round() as u64)),
            release,
        )
    }
    fn advance_event(&mut self, strum: bool) {
        let current = if strum {
            self.cursor
        } else {
            self.chord_cursor
        };
        let mut next = self.find_event(current + 1, strum);
        if next == self.score_len && self.looping {
            next = self.find_event(0, strum);
            if strum {
                self.cycle = self.cycle.saturating_add(self.duration);
            } else {
                self.chord_cycle = self.chord_cycle.saturating_add(self.duration);
            }
        }
        if strum {
            self.cursor = next;
        } else {
            self.chord_cursor = next;
        }
    }
    fn score_tick(&mut self) {
        if !self.playing || self.fade > 0 {
            return;
        }
        // Independent cursors let a strum prepare before a simultaneous chord-only event,
        // including preparation for the next loop before the current loop's final chord.
        // Work stays bounded even for pathological sub-sample loops.
        for _ in 0..self.score_len * 2 {
            let (strum_at, strum_release) = self.event_deadline(self.cursor, self.cycle, true);
            let (chord_at, chord_release) =
                self.event_deadline(self.chord_cursor, self.chord_cycle, false);
            let strum = strum_at <= chord_at;
            let (preparation, release, index) = if strum {
                (strum_at, strum_release, self.cursor)
            } else {
                (chord_at, chord_release, self.chord_cursor)
            };
            if self.clock < preparation {
                break;
            }
            if index == self.score_len {
                break;
            }
            // Short external scores may have overlapping anticipation windows.
            // Finish the earlier grip before planning the following deadline.
            if self.grip_at > self.clock && release > self.grip_at {
                break;
            }
            let event = self.score[index];
            // A late earlier chord must not undo a later strum's prepared fret boundaries.
            if release >= self.fret_event {
                self.set_shape_at(event.frets, release);
                self.fret_event = release;
            }
            if event.direction >= 2 {
                let index = (event.direction - 2) as usize;
                if !self.strings[index].held && event.frets[index] >= 0 && event.strength > 0.0 {
                    self.schedule_pick(index, release, event.strength);
                }
            } else {
                self.schedule_strum(release, event.direction, event.strength);
            }
            self.advance_event(strum);
        }
        if !self.looping && self.clock >= self.start.saturating_add(self.duration) {
            self.playing = false;
        }
    }
    pub fn render(&mut self, out: &mut [f32]) {
        let presence = instrument::BODIES[self.body_profile].string_presence;
        let acoustic = self.pickup == Pickup::Acoustic;
        for sample in out {
            self.score_tick();
            self.grip_tick();
            let sub = self.strings[0].sub;
            let mut value = 0.0;
            let mut pickup_sum = 0.0;
            for _ in 0..sub {
                let mut force = 0.0;
                let mut pickup = 0.0;
                for s in &mut self.strings {
                    let (p, f) = s.tick(
                        self.clock,
                        self.fs * sub as f64,
                        self.body.bridge,
                        self.pickup,
                    );
                    pickup += p;
                    force += f;
                }
                if acoustic {
                    let radiation = self.body.step(force);
                    value += (radiation * 0.95 + pickup * 0.28) / sub as f64;
                }
                pickup_sum += pickup;
            }
            if !acoustic {
                value = self.pickup_circuit.step(pickup_sum / sub as f64);
            } else if presence > 0.0 {
                // Bring back string attack above the flat tops' body resonances.
                let pickup = pickup_sum / sub as f64;
                self.pickup_low += (pickup - self.pickup_low) * self.pickup_low_step;
                value += (pickup - self.pickup_low) * presence;
            }
            self.body_envelope = (self.body_envelope * 0.9995).max(value.abs());
            if self.fade > 0 {
                value *= self.fade as f64 / self.fade_length.max(1) as f64;
                self.fade -= 1;
                if self.fade == 0 {
                    self.clear_sound();
                }
            }
            value = if value.is_finite() {
                value.clamp(-1.0, 1.0)
            } else {
                self.hard_reset();
                0.0
            };
            *sample = value as f32;
            self.sum += value * value;
            self.count += 1;
            self.clock = self.clock.saturating_add(1);
        }
    }
    /// Header: clock, RMS, playing, step, BPM, loop, duration, playhead, body envelope,
    /// last direction, first audible strum time, event count, dropped events, 3 reserved.
    /// Each string: fret, held mute, plucking, position, pull, envelope, RMS, 257 displacements.
    pub fn telemetry(&mut self, out: &mut [f64; TELE_LEN]) {
        out.fill(0.0);
        let elapsed = self.clock.saturating_sub(self.start);
        let playhead = if self.looping {
            elapsed % self.duration
        } else {
            elapsed.min(self.duration)
        } as f64
            / self.fs;
        let step = if self.playing && self.clock >= self.start {
            self.score[..self.score_len]
                .iter()
                .rev()
                .find(|e| e.time <= playhead)
                .map_or(-1.0, |e| e.step as f64)
        } else {
            -1.0
        };
        out[..13].copy_from_slice(&[
            self.clock(),
            rms(self.sum, self.count),
            self.playing as u8 as f64,
            step,
            self.bpm,
            self.looping as u8 as f64,
            self.duration as f64 / self.fs,
            playhead,
            self.body_envelope,
            self.last_direction as f64,
            self.last_strum,
            self.score_len as f64,
            self.dropped as f64,
        ]);
        out[15] = if self.grip_at > self.grip_start {
            ((self.clock - self.grip_start) as f64 / (self.grip_at - self.grip_start) as f64)
                .min(1.0)
        } else {
            1.0
        };
        for i in 0..6 {
            out[48 + i] = self.grip_target[i] as f64;
        }
        for (i, s) in self.strings.iter().enumerate() {
            out[56 + i] = if self.grip_target[i] > 0 {
                3.0 * s.pressure
            } else {
                0.0
            };
        }
        out[13] = self.body.bridge;
        out[14] = self.body.air;
        out[62] = self.body.back_displacement();
        for (i, m) in self.body.modes.iter().enumerate() {
            out[16 + i * 2] = m.q;
            out[17 + i * 2] = (m.q - m.prev) / self.body.dt;
        }
        for (i, s) in self.strings.iter_mut().enumerate() {
            out[64 + i] = if s.stroke_release == NO_EVENT {
                -1.0
            } else {
                s.stroke_release as f64 / self.fs
            };
            let offset = TELE_HEADER + i * STRING_TELE_LEN;
            out[offset..offset + 7].copy_from_slice(&[
                s.fret as f64,
                s.held as u8 as f64,
                s.contact as u8 as f64,
                s.position as f64 / s.n as f64,
                s.pull,
                s.envelope,
                rms(s.sum, self.count),
            ]);
            for j in 0..=N {
                let x = j as f64 * s.n as f64 / N as f64;
                let a = x.floor() as usize;
                let b = (a + 1).min(s.n);
                out[offset + 7 + j] = s.y[a] + (s.y[b] - s.y[a]) * (x - a as f64);
            }
            s.sum = 0.0;
        }
        self.sum = 0.0;
        self.count = 0;
    }
}
fn strength_value(x: f64) -> f64 {
    if x.is_finite() {
        x.clamp(0.0, 1.0)
    } else {
        0.0
    }
}
fn rms(sum: f64, count: usize) -> f64 {
    if count > 0 {
        (sum / count as f64).sqrt()
    } else {
        0.0
    }
}
