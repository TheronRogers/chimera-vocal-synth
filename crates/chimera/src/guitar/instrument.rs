//! Reduced acoustic profiles. The scale and tuning stay fixed across instruments.
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyProfile {
    pub name: &'static str,
    pub length_scale: f64,
    pub width_scale: f64,
    pub depth_scale: f64,
    pub arch: f64,
    pub default_strings: usize,
    pub frequency_scale: f64,
    pub cavity_litres: f64,
    pub port_area_scale: f64,
    pub top_loss_scale: f64,
    pub bridge_scale: f64,
    pub bridge_tilt: f64,
    pub string_presence: f64,
}

pub const BODIES: [BodyProfile; 6] = [
    BodyProfile {
        name: "Dreadnought",
        length_scale: 1.0,
        width_scale: 1.0,
        depth_scale: 1.0,
        arch: 0.0,
        default_strings: 0,
        frequency_scale: 1.0,
        cavity_litres: 16.0,
        port_area_scale: 1.0,
        top_loss_scale: 1.0,
        bridge_scale: 1.0,
        bridge_tilt: 0.0,
        string_presence: 0.39,
    },
    BodyProfile {
        name: "Parlor",
        length_scale: 0.89,
        width_scale: 0.82,
        depth_scale: 0.79,
        arch: 0.0,
        default_strings: 1,
        frequency_scale: 1.29,
        cavity_litres: 10.0,
        port_area_scale: 0.78,
        top_loss_scale: 1.10,
        bridge_scale: 0.9,
        bridge_tilt: 0.45,
        string_presence: 0.34,
    },
    BodyProfile {
        name: "Concert / OM",
        length_scale: 0.95,
        width_scale: 0.92,
        depth_scale: 0.90,
        arch: 0.0,
        default_strings: 1,
        frequency_scale: 1.12,
        cavity_litres: 13.0,
        port_area_scale: 0.90,
        top_loss_scale: 1.05,
        bridge_scale: 1.07,
        bridge_tilt: 0.13,
        string_presence: 0.37,
    },
    BodyProfile {
        name: "Jumbo",
        length_scale: 1.05,
        width_scale: 1.06,
        depth_scale: 1.07,
        arch: 0.0,
        default_strings: 0,
        frequency_scale: 0.89,
        cavity_litres: 19.0,
        port_area_scale: 1.03,
        top_loss_scale: 0.97,
        bridge_scale: 1.17,
        bridge_tilt: -0.45,
        string_presence: 0.39,
    },
    BodyProfile {
        name: "Classical",
        length_scale: 0.95,
        width_scale: 0.91,
        depth_scale: 0.87,
        arch: 0.0,
        default_strings: 3,
        frequency_scale: 0.94,
        cavity_litres: 12.5,
        port_area_scale: 0.80,
        top_loss_scale: 1.14,
        bridge_scale: 1.26,
        bridge_tilt: -0.25,
        string_presence: 0.0,
    },
    BodyProfile {
        name: "Hollow archtop · f-holes",
        length_scale: 1.01,
        width_scale: 1.03,
        depth_scale: 0.76,
        arch: 0.018,
        default_strings: 4,
        frequency_scale: 1.36,
        cavity_litres: 12.0,
        port_area_scale: 0.34,
        top_loss_scale: 0.90,
        bridge_scale: 0.79,
        bridge_tilt: 0.55,
        string_presence: 0.0,
    },
];

#[derive(Serialize)]
pub struct StringProfile {
    pub name: &'static str,
    pub tension: [f64; 6],
    pub loss: f64,
    /// Core material decay per second at 2 kHz, from bass to treble.
    pub core_overtone_loss: [f64; 6],
    /// Wound strings occupy the low end of the set.
    pub wound_count: usize,
    /// Additional overtone decay from the winding.
    pub winding_loss: f64,
}

impl StringProfile {
    pub fn overtone_loss(&self, string: usize) -> f64 {
        let winding = if string < self.wound_count {
            self.winding_loss
        } else {
            0.0
        };
        self.core_overtone_loss[string] + winding
    }
}

pub const STRINGS: [StringProfile; 5] = [
    StringProfile {
        name: "Steel · medium bronze",
        tension: [68.4; 6],
        loss: 1.5,
        core_overtone_loss: [2.0; 6],
        wound_count: 4,
        winding_loss: 2.0,
    },
    StringProfile {
        name: "Steel · light phosphor bronze",
        tension: [62.0, 65.0, 66.0, 63.0, 54.0, 56.0],
        loss: 1.75,
        core_overtone_loss: [0.75; 6],
        wound_count: 4,
        winding_loss: 0.75,
    },
    StringProfile {
        name: "Silk and steel",
        tension: [49.0, 52.0, 56.0, 54.0, 49.0, 51.0],
        loss: 2.45,
        core_overtone_loss: [12.0; 6],
        wound_count: 4,
        winding_loss: 4.0,
    },
    StringProfile {
        name: "Nylon · normal tension",
        tension: [60.0, 65.0, 67.0, 54.0, 52.0, 68.0],
        loss: 2.7,
        core_overtone_loss: [7.0, 7.0, 9.0, 28.0, 30.0, 32.0],
        wound_count: 3,
        winding_loss: 6.0,
    },
    StringProfile {
        name: "Steel · flatwound",
        tension: [68.0, 72.0, 72.0, 71.0, 62.0, 65.0],
        loss: 2.15,
        core_overtone_loss: [19.0, 19.0, 15.0, 13.0, 17.0, 17.0],
        wound_count: 4,
        winding_loss: 17.0,
    },
];
