//! A transverse string in metres: tension / linear density sets wave speed.
//! Fixed-size FDTD state, contact projections, and a velocity pickup; no I/O.
pub const N: usize = 256;
pub const FRET: usize = 14;
pub const TELE_LEN: usize = 7 + N + 1;
pub const LENGTH: f64 = 0.648;
pub const DENSITY: f64 = 0.006;
pub const SPEED: f64 = 2.0 * LENGTH * 82.41;
pub const TENSION: f64 = SPEED * SPEED * DENSITY;

pub struct GuitarVoice {
    y: [f64; N + 1],
    prev: [f64; N + 1],
    next: [f64; N + 1],
    envelope: [f64; N + 1],
    fs: f64,
    sub: usize,
    lambda2: f64,
    damping: f64,
    fret: f64,
    fret_target: f64,
    contact: bool,
    position: usize,
    pull: f64,
    target: f64,
    gesture: usize,
    clock: u64,
    dc_x: f64,
    dc_y: f64,
    sum: f64,
    count: usize,
}
impl GuitarVoice {
    pub fn new(fs: f64) -> Self {
        let sub = ((SPEED * N as f64 / LENGTH / fs / 0.8).ceil() as usize).max(1);
        let dt = 1.0 / (fs * sub as f64);
        Self {
            y: [0.0; N + 1],
            prev: [0.0; N + 1],
            next: [0.0; N + 1],
            envelope: [0.0; N + 1],
            fs,
            sub,
            lambda2: (SPEED * dt * N as f64 / LENGTH).powi(2),
            damping: 1.5 * dt,
            fret: 0.0,
            fret_target: 0.0,
            contact: false,
            position: 205,
            pull: 0.0,
            target: 0.0,
            gesture: 0,
            clock: 0,
            dc_x: 0.0,
            dc_y: 0.0,
            sum: 0.0,
            count: 0,
        }
    }
    pub fn fret(&mut self, pressure: f64) {
        self.fret_target = if pressure.is_finite() {
            pressure.clamp(0.0, 1.0)
        } else {
            0.0
        };
    }
    pub fn contact(&mut self, position: f64, displacement: f64, held: bool) {
        if !position.is_finite() || !displacement.is_finite() {
            self.release();
            return;
        }
        self.position = (position.clamp(0.15, 0.95) * N as f64).round() as usize;
        self.target = displacement.clamp(-0.004, 0.004);
        if held && !self.contact {
            self.pull = self.y[self.position];
        }
        self.contact = held;
        self.gesture = 0;
    }
    pub fn release(&mut self) {
        self.contact = false;
        self.gesture = 0;
    }
    /// A timed pull and release, advanced by audio samples rather than browser timers.
    pub fn pluck(&mut self) {
        self.contact(0.8, 0.002, true);
        self.gesture = (self.fs * 0.025) as usize;
    }
    pub fn mute(&mut self) {
        self.y.fill(0.0);
        self.prev.fill(0.0);
        self.next.fill(0.0);
        self.envelope.fill(0.0);
        self.release();
        self.fret(0.0);
        self.fret = 0.0;
        self.dc_x = 0.0;
        self.dc_y = 0.0;
        self.sum = 0.0;
        self.count = 0;
    }
    pub fn render(&mut self, out: &mut [f32]) {
        let dt = 1.0 / (self.fs * self.sub as f64);
        for sample in out {
            let before = self.y[221];
            for _ in 0..self.sub {
                self.fret += (self.fret_target - self.fret) * (dt / 0.002).min(1.0);
                if (self.fret - self.fret_target).abs() < 1e-5 {
                    self.fret = self.fret_target;
                }
                for i in 1..N {
                    self.next[i] = (2.0 * self.y[i] - (1.0 - self.damping) * self.prev[i]
                        + self.lambda2 * (self.y[i - 1] - 2.0 * self.y[i] + self.y[i + 1]))
                        / (1.0 + self.damping);
                }
                // A fully pressed fret is a fixed boundary; light touch dissipates energy.
                self.next[FRET] *= 1.0 - self.fret;
                if self.contact {
                    self.pull += (self.target - self.pull) * (dt / 0.003).min(1.0);
                    self.next[self.position] = self.pull;
                }
                core::mem::swap(&mut self.prev, &mut self.y);
                core::mem::swap(&mut self.y, &mut self.next);
            }
            if self.gesture > 0 {
                self.gesture -= 1;
                if self.gesture == 0 {
                    self.contact = false;
                }
            }
            let x = (self.y[221] - before) * self.fs * 0.15;
            let z = x - self.dc_x + 0.995 * self.dc_y;
            self.dc_x = x;
            self.dc_y = z;
            *sample = z.clamp(-1.0, 1.0) as f32;
            self.sum += z * z;
            self.count += 1;
            self.clock += 1;
            for i in 0..=N {
                self.envelope[i] = (self.envelope[i] * 0.9998).max(self.y[i].abs());
            }
        }
    }
    /// clock, RMS, fret pressure, held, position, pull, peak envelope, then displacement.
    pub fn telemetry(&mut self, out: &mut [f64; TELE_LEN]) {
        out[0] = self.clock as f64 / self.fs;
        out[1] = if self.count > 0 {
            (self.sum / self.count as f64).sqrt()
        } else {
            0.0
        };
        out[2] = self.fret;
        out[3] = self.contact as u8 as f64;
        out[4] = self.position as f64 / N as f64;
        out[5] = self.pull;
        out[6] = self.envelope.iter().copied().fold(0.0, f64::max);
        out[7..].copy_from_slice(&self.y);
        self.sum = 0.0;
        self.count = 0;
    }
}
