//! Mass-normalized plate modes and a reciprocal lumped air/soundhole oscillator.
use crate::math;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
#[derive(Deserialize, Serialize)]
pub struct ModeData {
    pub hz: f64,
    pub bridge: f64,
    pub volume: f64,
    pub shape: Vec<f64>,
}
#[derive(Deserialize, Serialize)]
pub struct BodyData {
    pub nodes: Vec<[f64; 2]>,
    #[serde(default)]
    pub triangles: Vec<usize>,
    pub modes: Vec<ModeData>,
}
pub fn data() -> &'static BodyData {
    static DATA: OnceLock<BodyData> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("body.generated.json")).expect("generated guitar modes")
    })
}
#[derive(Clone, Copy)]
pub struct Mode {
    pub q: f64,
    pub prev: f64,
    pub omega2: f64,
    pub bridge: f64,
    pub volume: f64,
    pub damping: f64,
}
pub struct Body {
    pub modes: [Mode; 16],
    pub air: f64,
    pub air_prev: f64,
    pub dt: f64,
    pub velocity: f64,
    pub bridge: f64,
}
impl Body {
    pub fn new(dt: f64) -> Self {
        let d = data();
        Self {
            modes: core::array::from_fn(|i| {
                let m = &d.modes[i];
                Mode {
                    q: 0.0,
                    prev: 0.0,
                    omega2: (math::TAU * m.hz).powi(2),
                    bridge: m.bridge * 0.05,
                    volume: m.volume,
                    damping: 3.0 + m.hz * 0.025,
                }
            }),
            air: 0.0,
            air_prev: 0.0,
            dt,
            velocity: 0.0,
            bridge: 0.0,
        }
    }
    pub fn step(&mut self, force: f64) -> f64 {
        let dt = self.dt;
        let old_bridge = self.bridge;
        // Cavity compliance: bulk modulus / volume. Air coordinate is volume
        // displacement through the hole; pressure pushes back on the top.
        let compliance = 142000.0 / 0.016;
        let mass = 1.2 * 0.085 / (math::PI * 0.05 * 0.05);
        let volume = self.modes.iter().map(|m| m.q * m.volume).sum::<f64>();
        let pressure = compliance * (volume - self.air);
        let next_air = (2.0 * self.air - (1.0 - 8.0 * dt) * self.air_prev
            + dt * dt * pressure / mass)
            / (1.0 + 8.0 * dt);
        self.air_prev = self.air;
        self.air = next_air;
        self.bridge = 0.0;
        let mut radiation = 0.0;
        for m in &mut self.modes {
            let next = (2.0 * m.q - (1.0 - m.damping * dt) * m.prev
                + dt * dt * (force * m.bridge - m.omega2 * m.q - pressure * m.volume))
                / (1.0 + m.damping * dt);
            let velocity = (next - m.prev) / (2.0 * dt);
            m.prev = m.q;
            m.q = next;
            self.bridge += m.bridge * next;
            radiation += m.volume * velocity;
        }
        self.velocity = (self.bridge - old_bridge) / dt;
        radiation * 90.0 + (self.air - self.air_prev) / dt * 40.0
    }
    pub fn clear(&mut self) {
        for m in &mut self.modes {
            m.q = 0.0;
            m.prev = 0.0;
        }
        self.air = 0.0;
        self.air_prev = 0.0;
        self.bridge = 0.0;
        self.velocity = 0.0;
    }
}
