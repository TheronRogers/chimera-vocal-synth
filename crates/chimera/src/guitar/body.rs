//! Mass-normalized plate modes and a reciprocal lumped air/soundhole oscillator.
use super::instrument::BodyProfile;
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
    back: f64,
    back_prev: f64,
    compliance: f64,
    air_mass: f64,
    back_omega2: f64,
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
            back: 0.0,
            back_prev: 0.0,
            compliance: 142000.0 / 0.016,
            air_mass: 1.2 * 0.085 / (math::PI * 0.05 * 0.05),
            back_omega2: (math::TAU * 220.0) * (math::TAU * 220.0),
            dt,
            velocity: 0.0,
            bridge: 0.0,
        }
    }
    pub fn set_profile(&mut self, profile: &BodyProfile) {
        self.compliance = 142000.0 / (profile.cavity_litres * 0.001);
        self.air_mass = (1.2 * 0.085 / (math::PI * 0.05 * 0.05)) / profile.port_area_scale;
        let back_hz = math::TAU * (220.0 * profile.frequency_scale);
        self.back_omega2 = back_hz * back_hz;
        for (mode, base) in self.modes.iter_mut().zip(&data().modes) {
            let hz = base.hz * profile.frequency_scale;
            mode.omega2 = (math::TAU * hz).powi(2);
            mode.damping = (3.0 + hz * 0.025) * profile.top_loss_scale;
            // The same participation governs excitation and motion at the bridge.
            let tilt = 1.0 + profile.bridge_tilt * (hz - 350.0) / (hz + 350.0);
            mode.bridge = base.bridge * 0.05 * profile.bridge_scale * tilt;
            mode.volume = base.volume * profile.length_scale * profile.width_scale;
        }
    }
    pub fn step(&mut self, force: f64) -> f64 {
        let dt = self.dt;
        let old_bridge = self.bridge;
        // Bulk modulus divided by cavity volume. A positive top displacement
        // increases volume and draws the soundhole air and back inward.
        let volume = self.modes.iter().map(|m| m.q * m.volume).sum::<f64>();
        // The back's lowest bending mode and the soundhole coordinate both
        // reduce cavity volume. Use the same effective area for force and flow.
        const BACK_AREA: f64 = 0.055;
        const BACK_MASS: f64 = 0.16;
        let suction = self.compliance * (volume - self.air - BACK_AREA * self.back);
        let next_back = (2.0 * self.back - (1.0 - 16.0 * dt) * self.back_prev
            + dt * dt * (suction * BACK_AREA / BACK_MASS - self.back_omega2 * self.back))
            / (1.0 + 16.0 * dt);
        let back_flow = BACK_AREA * (next_back - self.back_prev) / (2.0 * dt);
        self.back_prev = self.back;
        self.back = next_back;
        let next_air = (2.0 * self.air - (1.0 - 8.0 * dt) * self.air_prev
            + dt * dt * suction / self.air_mass)
            / (1.0 + 8.0 * dt);
        let hole_flow = (next_air - self.air_prev) / (2.0 * dt);
        self.air_prev = self.air;
        self.air = next_air;
        self.bridge = 0.0;
        let mut top_flow = 0.0;
        for m in &mut self.modes {
            let next = (2.0 * m.q - (1.0 - m.damping * dt) * m.prev
                + dt * dt * (force * m.bridge - m.omega2 * m.q - suction * m.volume))
                / (1.0 + m.damping * dt);
            let velocity = (next - m.prev) / (2.0 * dt);
            m.prev = m.q;
            m.q = next;
            self.bridge += m.bridge * next;
            top_flow += m.volume * velocity;
        }
        self.velocity = (self.bridge - old_bridge) / dt;
        // Sum the signed outward volume velocities at the same time level.
        (top_flow - hole_flow - back_flow) * 90.0
    }
    /// The cavity coordinate is positive inward. Scene depth is positive toward the top.
    pub fn back_displacement(&self) -> f64 {
        self.back
    }
    pub fn clear(&mut self) {
        for m in &mut self.modes {
            m.q = 0.0;
            m.prev = 0.0;
        }
        self.back = 0.0;
        self.back_prev = 0.0;
        self.air = 0.0;
        self.air_prev = 0.0;
        self.bridge = 0.0;
        self.velocity = 0.0;
    }
}
