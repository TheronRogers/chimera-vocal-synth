//! Six transverse strings and a reduced acoustic-body model, with bounded audio-clock events.
//! Fixed grids retain real displacement/contact state; no samples, oscillators or I/O.
use crate::math;

pub const STRING_COUNT: usize = 6;
pub const N: usize = 256;
pub const GUITAR_LAYOUT_VERSION: u32 = 2;
pub const TELE_HEADER: usize = 16;
pub const STRING_TELE_LEN: usize = 7 + N + 1;
pub const TELE_LEN: usize = TELE_HEADER + STRING_COUNT * STRING_TELE_LEN;
pub const CAPACITY: usize = 2048;
pub const LENGTH: f64 = 0.648;
pub const OPEN_MIDI: [u8; STRING_COUNT] = [40, 45, 50, 55, 59, 64];
const PULL_SECONDS: f64 = 0.025;
const STRUM_SECONDS: f64 = 0.008;
const NO_EVENT: u64 = u64::MAX;

#[derive(Clone, Copy, Debug)]
pub struct GuitarEvent {
    /// Audible first-string release, in seconds relative to the score start.
    pub time: f64,
    pub frets: [i8; STRING_COUNT],
    /// +1 low to high, -1 high to low, 0 changes the chord without excitation.
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

struct StringVoice {
    y: [f64; N + 1],
    prev: [f64; N + 1],
    next: [f64; N + 1],
    sub: usize,
    lambda2: f64,
    damping: f64,
    damping_inverse: f64,
    mute_decay: f64,
    pull_rate: f64,
    tension: f64,
    fret: i8,
    boundary: usize,
    held: bool,
    active: bool,
    contact: bool,
    position: usize,
    pull: f64,
    target: f64,
    prepare: u64,
    release: u64,
    envelope: f64,
    dc_x: f64,
    dc_y: f64,
    sum: f64,
}
impl StringVoice {
    fn new(fs: f64, midi: u8) -> Self {
        let speed = 2.0 * LENGTH * math::midi_to_hz(midi as f64);
        let sub = ((speed * N as f64 / LENGTH / fs / 0.8).ceil() as usize).max(1);
        let dt = 1.0 / (fs * sub as f64);
        // Equal nominal tension, differing linear densities/gauges across the strings.
        let tension = 68.4;
        Self {
            y: [0.0; N + 1],
            prev: [0.0; N + 1],
            next: [0.0; N + 1],
            sub,
            lambda2: (speed * dt * N as f64 / LENGTH).powi(2),
            damping: 1.5 * dt,
            damping_inverse: 1.0 / (1.0 + 1.5 * dt),
            mute_decay: math::exp(-dt / 0.006),
            pull_rate: (dt / 0.003).min(1.0),
            tension,
            fret: 0,
            boundary: 0,
            held: false,
            active: false,
            contact: false,
            position: 205,
            pull: 0.0,
            target: 0.0,
            prepare: NO_EVENT,
            release: NO_EVENT,
            envelope: 0.0,
            dc_x: 0.0,
            dc_y: 0.0,
            sum: 0.0,
        }
    }
    fn set_fret(&mut self, fret: i8) {
        let fret = fret.clamp(-1, 12);
        if self.fret == fret {
            return;
        }
        self.fret = fret;
        self.boundary = if self.fret > 0 {
            (N as f64 * (1.0 - math::pow(2.0, -(self.fret as f64) / 12.0))).round() as usize
        } else {
            0
        };
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
    fn schedule(&mut self, release: u64, pull_samples: u64, strength: f64) {
        if self.held || self.fret < 0 || strength <= 0.0 {
            return;
        }
        self.target = 0.0025 * strength;
        self.prepare = release.saturating_sub(pull_samples);
        self.release = release;
    }
    fn tick(&mut self, clock: u64, fs: f64) -> (f64, f64) {
        if self.prepare != NO_EVENT && clock >= self.prepare {
            self.prepare = NO_EVENT;
            self.contact = true;
            self.active = true;
            self.pull = self.y[self.position];
        }
        if self.release != NO_EVENT && clock >= self.release {
            self.release = NO_EVENT;
            self.contact = false;
        }
        if !self.active {
            return (0.0, 0.0);
        }
        let before = self.y[221];
        let muted = self.held || self.fret < 0;
        for _ in 0..self.sub {
            for i in self.boundary + 1..N {
                self.next[i] = (2.0 * self.y[i] - (1.0 - self.damping) * self.prev[i]
                    + self.lambda2 * (self.y[i - 1] - 2.0 * self.y[i] + self.y[i + 1]))
                    * self.damping_inverse;
            }
            if self.contact {
                self.pull += (self.target - self.pull) * self.pull_rate;
                self.next[self.position] = self.pull;
            }
            if muted {
                for i in self.boundary + 1..N {
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
            let peak = self.y[self.boundary + 1..N]
                .iter()
                .fold(0.0f64, |p, x| p.max(x.abs()));
            self.envelope = self.envelope.max(peak);
        }
        let pickup = (self.y[221] - before) * fs * 0.15;
        let highpass = pickup - self.dc_x + 0.995 * self.dc_y;
        self.dc_x = pickup;
        self.dc_y = highpass;
        // Pull preparation is mechanical state, not an early audible onset.
        let audio = if self.contact { 0.0 } else { highpass };
        let force = if self.contact {
            0.0
        } else {
            self.tension * self.y[N - 1] / (LENGTH / N as f64)
        };
        self.sum += audio * audio;
        if self.envelope < 1e-12 && !self.contact && self.release == NO_EVENT {
            self.reset();
        }
        (audio, force)
    }
}

#[derive(Clone, Copy)]
struct BodyMode {
    a: f64,
    b: f64,
    gain: f64,
    weight: f64,
    y1: f64,
    y2: f64,
}
impl BodyMode {
    fn new(fs: f64, hz: f64, bandwidth: f64, weight: f64) -> Self {
        let r = math::exp(-math::PI * bandwidth / fs);
        let angle = math::TAU * hz / fs;
        Self {
            a: 2.0 * r * math::cos(angle),
            b: -r * r,
            gain: 2.0 * (1.0 - r) * math::sin(angle),
            weight,
            y1: 0.0,
            y2: 0.0,
        }
    }
    fn tick(&mut self, force: f64) -> f64 {
        let y = self.a * self.y1 + self.b * self.y2 + self.gain * force;
        self.y2 = self.y1;
        self.y1 = if y.abs() < 1e-24 { 0.0 } else { y };
        y * self.weight
    }
}

pub struct GuitarVoice {
    strings: [StringVoice; STRING_COUNT],
    body: [BodyMode; 8],
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
}
impl GuitarVoice {
    pub fn new(fs: f64) -> Self {
        let fs = if fs.is_finite() && fs >= 8000.0 {
            fs
        } else {
            48000.0
        };
        Self {
            strings: core::array::from_fn(|i| StringVoice::new(fs, OPEN_MIDI[i])),
            body: [
                BodyMode::new(fs, 105.0, 12.0, 1.8),
                BodyMode::new(fs, 190.0, 18.0, 1.3),
                BodyMode::new(fs, 290.0, 25.0, 1.0),
                BodyMode::new(fs, 440.0, 40.0, 0.8),
                BodyMode::new(fs, 680.0, 60.0, 0.5),
                BodyMode::new(fs, 1020.0, 90.0, 0.35),
                BodyMode::new(fs, 1480.0, 130.0, 0.23),
                BodyMode::new(fs, 2200.0, 190.0, 0.14),
            ],
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
        }
    }
    pub fn clock(&self) -> f64 {
        self.clock as f64 / self.fs
    }
    pub fn set_fret(&mut self, index: usize, fret: i8) {
        if let Some(s) = self.strings.get_mut(index) {
            s.set_fret(fret);
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
            self.fade = 0;
            s.schedule(self.clock + self.pull_samples, self.pull_samples, strength);
        }
    }
    pub fn strum(&mut self, direction: i8, strength: f64) {
        let strength = strength_value(strength);
        if direction == 0 || strength == 0.0 {
            return;
        }
        self.fade = 0;
        self.schedule_strum(self.clock + self.pull_samples, direction, strength);
    }
    fn schedule_strum(&mut self, release: u64, direction: i8, strength: f64) {
        if direction == 0 {
            return;
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
            if self.strings[index].fret < 0 || self.strings[index].held {
                continue;
            }
            self.strings[index].schedule(
                release.saturating_add(onset * self.spacing),
                self.pull_samples,
                strength,
            );
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
            event.strength = strength_value(event.strength);
            event.direction = event.direction.signum();
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
        self.fade = 0;
        for s in &mut self.strings {
            s.reset();
        }
        for m in &mut self.body {
            m.y1 = 0.0;
            m.y2 = 0.0;
        }
        self.sum = 0.0;
        self.count = 0;
        self.body_envelope = 0.0;
    }
    fn find_event(&self, from: usize, strum: bool) -> usize {
        self.score[from..self.score_len]
            .iter()
            .position(|e| (e.direction != 0) == strum)
            .map_or(self.score_len, |i| from + i)
    }
    fn event_deadline(&self, cursor: usize, cycle: u64, strum: bool) -> (u64, u64) {
        if cursor == self.score_len {
            return (NO_EVENT, NO_EVENT);
        }
        let release = self
            .start
            .saturating_add(cycle)
            .saturating_add((self.score[cursor].time * self.fs).round() as u64);
        (
            if strum {
                release.saturating_sub(self.pull_samples)
            } else {
                release
            },
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
        if !self.playing {
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
            let event = self.score[index];
            // A late earlier chord must not undo a later strum's prepared fret boundaries.
            if release >= self.fret_event {
                for (s, fret) in self.strings.iter_mut().zip(event.frets) {
                    s.set_fret(fret);
                }
                self.fret_event = release;
            }
            self.schedule_strum(release, event.direction, event.strength);
            self.advance_event(strum);
        }
        if !self.looping && self.clock >= self.start.saturating_add(self.duration) {
            self.playing = false;
        }
    }
    pub fn render(&mut self, out: &mut [f32]) {
        for sample in out {
            self.score_tick();
            let (mut pickup, mut force) = (0.0, 0.0);
            for s in &mut self.strings {
                let (p, f) = s.tick(self.clock, self.fs);
                pickup += p;
                force += f;
            }
            let mut body = 0.0;
            for mode in &mut self.body {
                body += mode.tick(force * 0.2);
            }
            self.body_envelope = (self.body_envelope * 0.9995).max(body.abs());
            let mut value = pickup * 0.35 + body * 0.7;
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
        for (i, s) in self.strings.iter_mut().enumerate() {
            let offset = TELE_HEADER + i * STRING_TELE_LEN;
            out[offset..offset + 7].copy_from_slice(&[
                s.fret as f64,
                s.held as u8 as f64,
                s.contact as u8 as f64,
                s.position as f64 / N as f64,
                s.pull,
                s.envelope,
                rms(s.sum, self.count),
            ]);
            out[offset + 7..offset + STRING_TELE_LEN].copy_from_slice(&s.y);
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
