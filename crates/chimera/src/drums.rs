//! Modal rock kit: circular membranes, inharmonic metal plates and snare-wire contact.
//! Reduced physical models, not recordings. Coefficients are prepared off the render path.
use crate::math::{cos, exp, sin, Rng, PI, TAU};
const MODES: usize = 64;
pub const DRUM_LAYOUT_VERSION: u32 = 2;
/// clock, enabled, playing, bpm, start, duration, loop, wire RMS;
/// next hits[8], last hits[8], strengths[8], head modes[8×4], wire modes[24]; beater compression (m), hat pedal travel, gap (m), pressure (N), last hat closure (s).
pub const DRUM_TELE_LEN: usize = 93;
#[derive(Clone, Copy)]
struct PendingHit {
    at: u64,
    id: usize,
    force: f64,
}
const EMPTY_HIT: PendingHit = PendingHit {
    at: u64::MAX,
    id: 0,
    force: 0.0,
};
fn hand(id: usize) -> usize {
    if id == 0 {
        2
    } else if matches!(id, 2 | 5 | 6) {
        0
    } else {
        1
    }
}
fn groove(i: u64) -> [bool; 8] {
    let i = i % 8;
    [
        i == 0 || i == 4 || i == 5,
        i == 2 || i == 6,
        false,
        false,
        false,
        i != 0,
        i == 0,
        false,
    ]
}
const ROOTS: [f64; 12] = [
    2.4048, 3.8317, 5.1356, 5.5201, 6.3802, 7.0156, 7.5883, 8.4172, 8.6537, 9.7610, 10.1735,
    11.0647,
];

#[derive(Clone, Copy, Default)]
struct Mode {
    a: f64,
    b: f64,
    x: f64,
    old: f64,
    excitation: f64,
    pickup: f64,
    nonlinear: f64,
}
impl Mode {
    fn new(fs: f64, hz: f64, decay: f64, weight: f64) -> Self {
        if hz >= fs * 0.45 {
            return Self::default();
        }
        let w = TAU * hz / fs;
        let r = exp(-1.0 / (fs * decay));
        Self {
            a: 2.0 * r * cos(w),
            b: -r * r,
            excitation: sin(w) * weight,
            pickup: weight,
            nonlinear: 0.0,
            ..Self::default()
        }
    }
    fn strike(&mut self, force: f64) {
        self.old -= self.excitation * force;
    }
    fn tick(&mut self) -> f64 {
        let next = self.a * self.x + self.b * self.old - self.nonlinear * self.x * self.x * self.x;
        self.old = self.x;
        self.x = next;
        next * self.pickup
    }
    fn clear(&mut self) {
        self.x = 0.0;
        self.old = 0.0;
    }
}
/// Statistical approximation of energy scattered into unresolved plate modes.
struct CymbalWash {
    rng: Rng,
    stored: f64,
    wash: f64,
    low: f64,
    high: f64,
    decay: f64,
    attack: f64,
    low_rate: f64,
    high_rate: f64,
    gain: f64,
}

impl CymbalWash {
    fn new(fs: f64, seed: u32, attack: f64, decay: f64, band: [f64; 2], gain: f64) -> Self {
        Self {
            rng: Rng::new(seed),
            stored: 0.0,
            wash: 0.0,
            low: 0.0,
            high: 0.0,
            decay: exp(-1.0 / (fs * decay)),
            attack: 1.0 - exp(-1.0 / (fs * attack)),
            low_rate: 1.0 - exp(-TAU * band[0] / fs),
            high_rate: 1.0 - exp(-TAU * band[1] / fs),
            gain: gain * (fs / 48000.0).sqrt(),
        }
    }

    fn strike(&mut self, force: f64) {
        // Strong hits transfer a larger fraction of their energy into the wash.
        self.stored = (self.stored + force * (0.35 + 0.65 * force)).min(1.5);
    }

    fn tick(&mut self) -> f64 {
        self.wash += self.attack * (self.stored - self.wash);
        let pressure = self.rng.bipolar();
        self.low += self.low_rate * (pressure - self.low);
        self.high += self.high_rate * (pressure - self.low - self.high);
        let output = self.high * (0.12 * self.stored + self.wash) * self.gain;
        self.stored *= self.decay;
        output
    }

    fn clear(&mut self) {
        self.stored = 0.0;
        self.wash = 0.0;
        self.low = 0.0;
        self.high = 0.0;
    }
}

struct Drum {
    modes: [Mode; MODES],
    remaining: u64,
    lifetime: u64,
    count: usize,
    contact: usize,
    contact_left: usize,
    force: f64,
    radiation: f64,
    cymbal: Option<CymbalWash>,
    previous: f64,
}
impl Drum {
    fn new(
        fs: f64,
        radius: f64,
        tension: f64,
        density: f64,
        decay: f64,
        cymbal: Option<CymbalWash>,
    ) -> Self {
        let metal = cymbal.is_some();
        // Membrane f_mn = root_mn/(2πa) sqrt(T/σ). Plate modal spacing is inharmonic.
        let base = if metal {
            // Bronze thin-plate bending stiffness D=Eh³/[12(1−ν²)], areal mass ρh.
            // A cymbal is reduced here to a circular plate; bell and hammering are omitted.
            let thickness: f64 = 0.0012;
            let stiffness =
                110e9 * thickness * thickness * thickness / (12.0 * (1.0 - 0.34 * 0.34));
            3.196 * 3.196 / (TAU * radius * radius) * (stiffness / (8800.0 * thickness)).sqrt()
        } else {
            ROOTS[0] / (TAU * radius) * (tension / density).sqrt()
        };
        let modes = std::array::from_fn(|i| {
            let ratio = if metal {
                1.0 + 0.73 * i as f64 + 0.117 * (i * i) as f64
            } else if i < ROOTS.len() {
                ROOTS[i] / ROOTS[0]
            } else {
                (i as f64 + 1.5) * PI / ROOTS[0]
            };
            let damping = decay / (1.0 + i as f64 * if metal { 0.045 } else { 0.25 });
            let hz = base * ratio;
            let mut mode = Mode::new(
                fs,
                hz,
                damping,
                1.0 / (1.0 + i as f64 * if metal { 0.10 } else { 0.4 }),
            );
            if metal {
                // Small low-frequency plates radiate poorly: suppress the sub-bass gong modes.
                let ka = TAU * hz * radius / 343.0;
                mode.pickup *= (ka * ka).min(1.0);
            } else {
                // Membrane tension rises with deflection (weak Duffing hardening).
                mode.nonlinear = (TAU * hz / fs).powi(2) * 0.12;
            }
            mode
        });
        Self {
            modes,
            remaining: 0,
            lifetime: (fs * decay * 14.0) as u64,
            count: if metal { MODES } else { 24 },
            contact: (fs * if metal { 0.00035 } else { 0.001 }).round().max(1.0) as usize,
            contact_left: 0,
            force: 0.0,
            cymbal,
            radiation: if metal {
                0.23 * fs / (TAU * 700.0)
            } else {
                0.12 * fs / (TAU * base)
            },
            previous: 0.0,
        }
    }
    fn hit(&mut self, force: f64) {
        self.force = force;
        self.contact_left = self.contact;
        self.remaining = self.lifetime;
        if let Some(wash) = &mut self.cymbal {
            wash.strike(force);
        }
    }
    fn excite(&mut self, impulse: f64) {
        for mode in &mut self.modes[..self.count] {
            mode.strike(impulse);
        }
    }

    fn tick(&mut self, damping: f64) -> f64 {
        if self.remaining == 0 {
            return 0.0;
        }
        self.remaining -= 1;
        if self.contact_left > 0 {
            let phase = (self.contact - self.contact_left) as f64 / self.contact as f64;
            let impulse = self.force * 6.0 * phase * (1.0 - phase) / self.contact as f64;
            self.excite(impulse);
            self.contact_left -= 1;
        }
        if damping < 1.0 {
            for mode in &mut self.modes[..self.count] {
                mode.x *= damping;
                mode.old *= damping;
            }
        }
        let displacement = self.modes[..self.count]
            .iter_mut()
            .map(Mode::tick)
            .sum::<f64>();
        // Microphone pressure includes membrane velocity, sharpening the stick attack.
        let pressure = match &mut self.cymbal {
            Some(wash) => {
                wash.stored *= damping;
                wash.wash *= damping;
                wash.tick()
            }
            None => displacement,
        };
        let value = pressure + (displacement - self.previous) * self.radiation;
        self.previous = displacement;
        if self.remaining == 0 {
            self.clear();
        }
        value
    }
    fn clear(&mut self) {
        self.remaining = 0;
        self.contact_left = 0;
        self.previous = 0.0;
        if let Some(wash) = &mut self.cymbal {
            wash.clear();
        }
        for m in &mut self.modes {
            m.clear();
        }
    }
}

/// Felt beater contact. The scheduled strike specifies arrival at the head;
/// incoming speed, felt stiffness and damping determine the impulse over time.
#[derive(Default)]
struct KickBeater {
    compression: f64,
    velocity: f64,
}

impl KickBeater {
    fn impulse(&mut self, fs: f64) -> f64 {
        if self.compression == 0.0 && self.velocity <= 0.0 {
            return 0.0;
        }
        self.compression += self.velocity / fs;
        if self.compression <= 0.0 {
            *self = Self::default();
            return 0.0;
        }
        let force = (52_000.0 * self.compression + 9.0 * self.velocity).max(0.0);
        self.velocity -= force / (0.07 * fs);
        force / (0.32 * fs)
    }
}

const HAT_CONTACT: f64 = 0.65;
const HAT_REST: f64 = 0.80;

struct HatPedal {
    target: f64,
    travel: f64,
    response: f64,
    loss: f64,
    audible: bool,
    last_close: f64,
}

impl HatPedal {
    fn new(fs: f64) -> Self {
        Self {
            target: HAT_REST,
            travel: HAT_REST,
            response: 1.0 - exp(-1.0 / (0.022 * fs)),
            loss: 1.0 - exp(-76.0 / fs),
            audible: false,
            last_close: -1.0,
        }
    }

    fn gap(&self) -> f64 {
        0.018 * (1.0 - self.travel / HAT_CONTACT).max(0.0)
    }

    fn pressure(&self) -> f64 {
        35.0 * ((self.travel - HAT_CONTACT) / (1.0 - HAT_CONTACT)).max(0.0)
    }

    fn tick(&mut self) -> f64 {
        let previous = self.travel;
        self.travel += self.response * (self.target - self.travel);
        // The plates clap on first contact. Faster closure produces a stronger chick.
        if self.audible && previous < HAT_CONTACT && self.travel >= HAT_CONTACT {
            self.audible = false;
            (self.target - previous) * 0.85
        } else {
            0.0
        }
    }

    fn damping(&self) -> f64 {
        let proximity = (1.0 - self.gap() / 0.002).clamp(0.0, 1.0);
        1.0 - self.loss * proximity * (0.30 + 0.70 * self.pressure() / 35.0)
    }
}

pub struct RockKit {
    drums: [Drum; 8],
    wires: [Mode; 24],
    pending: [PendingHit; 32],
    last_hits: [f64; 8],
    strengths: [f64; 8],
    snare_previous: f64,
    beater: KickBeater,
    hat: HatPedal,
    fs: f64,
    enabled: bool,
    gain: f64,
    clock: u64,
    start: u64,
    duration: u64,
    next: u64,
    step: f64,
    looping: bool,
    playing: bool,
}
impl RockKit {
    pub fn new(fs: f64) -> Self {
        Self {
            drums: [
                Drum::new(fs, 0.28, 500.0, 0.25, 0.28, None),
                Drum::new(fs, 0.18, 1200.0, 0.22, 0.13, None),
                Drum::new(fs, 0.13, 700.0, 0.22, 0.32, None),
                Drum::new(fs, 0.16, 650.0, 0.22, 0.38, None),
                Drum::new(fs, 0.21, 600.0, 0.25, 0.45, None),
                Drum::new(
                    fs,
                    0.18,
                    0.0,
                    0.0,
                    0.18,
                    Some(CymbalWash::new(fs, 5, 0.0008, 0.14, [4500.0, 14000.0], 2.8)),
                ),
                Drum::new(
                    fs,
                    0.23,
                    0.0,
                    0.0,
                    0.36,
                    Some(CymbalWash::new(fs, 6, 0.007, 0.31, [2300.0, 12000.0], 2.6)),
                ),
                Drum::new(
                    fs,
                    0.26,
                    0.0,
                    0.0,
                    0.48,
                    Some(CymbalWash::new(fs, 7, 0.003, 0.37, [2800.0, 10500.0], 1.7)),
                ),
            ],
            wires: std::array::from_fn(|i| {
                Mode::new(
                    fs,
                    950.0 + 277.0 * i as f64 + 13.7 * (i * i) as f64,
                    0.024 + 0.001 * (i % 7) as f64,
                    0.14,
                )
            }),
            pending: [EMPTY_HIT; 32],
            last_hits: [-1.0; 8],
            strengths: [0.0; 8],
            snare_previous: 0.0,
            beater: KickBeater::default(),
            hat: HatPedal::new(fs),
            fs,
            enabled: false,
            gain: 0.5,
            clock: 0,
            start: 0,
            duration: 1,
            next: 0,
            step: fs * 0.25,
            looping: false,
            playing: false,
        }
    }
    pub fn set(&mut self, enabled: bool, gain: f64) {
        self.enabled = enabled;
        self.gain = if gain.is_finite() {
            gain.clamp(0.0, 1.0)
        } else {
            0.0
        };
        if !enabled {
            self.clear();
        }
    }
    pub fn set_hat_pedal(&mut self, travel: f64) {
        if travel.is_finite() {
            let target = travel.clamp(0.0, 1.0);
            if target != self.hat.target {
                self.hat.target = target;
                self.hat.audible = self.enabled;
            }
        }
    }

    pub fn hit(&mut self, id: usize, force: f64) {
        if self.enabled && id < 8 && force.is_finite() {
            let force = force.clamp(0.0, 1.0);
            if id == 0 {
                self.beater = KickBeater {
                    compression: 0.0,
                    velocity: 2.8 * force,
                };
                self.drums[0].remaining = self.drums[0].lifetime;
            } else {
                self.drums[id].hit(force);
            }
            self.last_hits[id] = self.clock as f64 / self.fs;
            self.strengths[id] = force;
        }
    }
    /// A manual strike reserves travel time; same-hand requests cannot pile up at one instant.
    pub fn queue_hit(&mut self, id: usize, force: f64, lead: f64) {
        if !self.enabled || id >= 8 || !force.is_finite() || !lead.is_finite() {
            return;
        }
        let mut at = self
            .clock
            .saturating_add((lead.clamp(0.0, 1.0) * self.fs).round() as u64);
        for p in &self.pending {
            if p.at != u64::MAX && hand(p.id) == hand(id) {
                at = at.max(p.at.saturating_add((self.fs * 0.12) as u64));
            }
        }
        if let Some(slot) = self.pending.iter_mut().find(|p| p.at == u64::MAX) {
            *slot = PendingHit { at, id, force };
        }
    }
    pub fn telemetry(&self, out: &mut [f64; DRUM_TELE_LEN]) {
        out.fill(0.0);
        out[..8].copy_from_slice(&[
            self.clock as f64 / self.fs,
            self.enabled as u8 as f64,
            self.playing as u8 as f64,
            self.fs * 30.0 / self.step,
            self.start as f64 / self.fs,
            self.duration as f64 / self.fs,
            self.looping as u8 as f64,
            (self.wires.iter().map(|m| m.x * m.x).sum::<f64>() / 24.0).sqrt(),
        ]);
        out[8..16].fill(-1.0);
        if self.enabled && self.playing {
            let mut cycle = self.clock.saturating_sub(self.start) / self.duration;
            let mut cursor = self.next;
            for _ in 0..24 {
                let mut offset = (cursor as f64 * self.step).round() as u64;
                if offset >= self.duration {
                    if !self.looping {
                        break;
                    }
                    cycle += 1;
                    cursor = 0;
                    offset = 0;
                }
                let at = self.start + cycle * self.duration + offset;
                if at >= self.clock {
                    for (id, on) in groove(cursor).iter().enumerate() {
                        if *on && out[8 + id] < 0.0 {
                            out[8 + id] = at as f64 / self.fs;
                        }
                    }
                }
                cursor += 1;
            }
        }
        for p in &self.pending {
            if p.at != u64::MAX {
                let at = p.at as f64 / self.fs;
                if out[8 + p.id] < 0.0 || at < out[8 + p.id] {
                    out[8 + p.id] = at;
                }
            }
        }
        out[16..24].copy_from_slice(&self.last_hits);
        out[24..32].copy_from_slice(&self.strengths);
        for (i, drum) in self.drums.iter().enumerate() {
            for j in 0..4 {
                out[32 + i * 4 + j] = drum.modes[j].x;
            }
        }
        for (i, wire) in self.wires.iter().enumerate() {
            out[64 + i] = wire.x;
        }
        out[88..].copy_from_slice(&[
            self.beater.compression,
            self.hat.travel,
            self.hat.gap(),
            self.hat.pressure(),
            self.hat.last_close,
        ]);
    }
    pub fn schedule(&mut self, clock: f64, start: f64, duration: f64, looping: bool, bpm: f64) {
        self.stop();
        self.clock = (clock * self.fs).round() as u64;
        if !start.is_finite()
            || !duration.is_finite()
            || duration <= 0.0
            || !bpm.is_finite()
            || bpm <= 0.0
        {
            return;
        }
        self.start = (start * self.fs).round() as u64;
        self.duration = (duration * self.fs).round().max(1.0) as u64;
        self.step = self.fs * 30.0 / bpm.clamp(40.0, 200.0);
        self.looping = looping;
        self.playing = true;
    }
    fn clear(&mut self) {
        self.pending.fill(EMPTY_HIT);
        self.last_hits.fill(-1.0);
        self.strengths.fill(0.0);
        self.snare_previous = 0.0;
        self.beater = KickBeater::default();
        self.hat.audible = false;
        self.hat.last_close = -1.0;
        for d in &mut self.drums {
            d.clear();
        }
        for w in &mut self.wires {
            w.clear();
        }
    }
    pub fn stop(&mut self) {
        self.playing = false;
        self.next = 0;
        self.clear();
    }
    pub fn sample(&mut self) -> f64 {
        if self.playing && self.clock >= self.start {
            let elapsed = self.clock - self.start;
            if !self.looping && elapsed >= self.duration {
                self.playing = false;
            } else {
                let local = elapsed % self.duration;
                if self.looping && local == 0 {
                    self.next = 0;
                }
                if local >= (self.next as f64 * self.step).round() as u64 {
                    for (id, on) in groove(self.next).iter().enumerate() {
                        if *on {
                            self.hit(
                                id,
                                if id == 0 {
                                    0.85
                                } else if id == 1 {
                                    0.8
                                } else {
                                    0.55
                                },
                            );
                        }
                    }
                    self.next += 1;
                }
            }
        }
        for i in 0..self.pending.len() {
            let p = self.pending[i];
            if p.at <= self.clock {
                self.pending[i] = EMPTY_HIT;
                self.hit(p.id, p.force);
            }
        }
        self.clock += 1;
        let chick = self.hat.tick();
        if !self.enabled {
            return 0.0;
        }
        let impulse = self.beater.impulse(self.fs);
        if impulse > 0.0 {
            self.drums[0].excite(impulse);
        }
        if chick > 0.0 {
            self.drums[5].hit(chick);
            self.hat.last_close = (self.clock - 1) as f64 / self.fs;
        }
        let mut sum = 0.0;
        let hat_damping = self.hat.damping();
        for (i, drum) in self.drums.iter_mut().enumerate() {
            let x = drum.tick(if i == 5 { hat_damping } else { 1.0 });
            // Each wire has a distinct gap; unilateral contact and relative head velocity
            // cause many short, irregular impacts instead of a single pitched buzz.
            if i == 1 {
                let velocity = x - self.snare_previous;
                self.snare_previous = x;
                let mut reaction = 0.0;
                for (j, wire) in self.wires.iter_mut().enumerate() {
                    let relative = x - wire.x * 0.12;
                    let gap = 0.0025 + 0.0006 * (j % 5) as f64;
                    let penetration = (relative.abs() - gap).clamp(0.0, 0.2);
                    if penetration > 0.0 {
                        let force = relative.signum() * penetration * 0.018 + velocity * 0.15;
                        wire.strike(force);
                        reaction += force;
                    }
                }
                drum.modes[0].strike(-reaction * 0.012);
            }
            sum += x * if i >= 5 { 0.13 } else { 0.24 };
        }
        sum += self.wires.iter_mut().map(Mode::tick).sum::<f64>() * 2.0;
        sum * self.gain
    }
}
