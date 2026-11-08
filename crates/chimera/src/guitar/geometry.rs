//! Instrument-space metres: nut x=0, bridge x=scale, soundboard z=0.
use crate::math;
use serde::{Deserialize, Serialize};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub scale: f64,
    pub depth: f64,
    pub nut_width: f64,
    pub nut_spacing: f64,
    pub bridge_spacing: f64,
    pub outline: Vec<[f64; 2]>,
    pub soundhole: [f64; 3],
}
pub fn geometry() -> Geometry {
    // Smooth dreadnought bouts, sampled as a shared physical boundary.
    let stations = [
        (0.359, 0.0),
        (0.385, 0.105),
        (0.425, 0.145),
        (0.485, 0.137),
        (0.525, 0.117),
        (0.585, 0.135),
        (0.655, 0.185),
        (0.735, 0.200),
        (0.810, 0.165),
        (0.855, 0.09),
        (0.869, 0.0),
    ];
    let mut outline = Vec::new();
    for sign in [1.0, -1.0] {
        for k in 0..=100 {
            let t = if sign > 0.0 {
                k as f64 / 100.0
            } else {
                1.0 - k as f64 / 100.0
            };
            let u = t * 10.0;
            let i = (u.floor() as usize).min(9);
            let a = u - i as f64;
            let p0 = stations[i.saturating_sub(1)];
            let p1 = stations[i];
            let p2 = stations[i + 1];
            let p3 = stations[(i + 2).min(10)];
            let curve = |v0: f64, v1: f64, v2: f64, v3: f64| {
                0.5 * ((2.0 * v1)
                    + (-v0 + v2) * a
                    + (2.0 * v0 - 5.0 * v1 + 4.0 * v2 - v3) * a * a
                    + (-v0 + 3.0 * v1 - 3.0 * v2 + v3) * a * a * a)
            };
            outline.push([
                curve(p0.0, p1.0, p2.0, p3.0),
                sign * curve(p0.1, p1.1, p2.1, p3.1).max(0.0),
            ]);
        }
    }
    Geometry {
        scale: super::LENGTH,
        depth: 0.110,
        nut_width: 0.0445,
        nut_spacing: 0.035,
        bridge_spacing: 0.054,
        outline,
        soundhole: [0.505, 0.0, 0.050],
    }
}
pub fn fret_x(f: i8) -> f64 {
    super::LENGTH * (1.0 - math::pow(2.0, -f as f64 / 12.0))
}
pub fn string_y(i: usize, x: f64) -> f64 {
    (i as f64 - 2.5) * (0.035 + 0.019 * x / super::LENGTH) / 5.0
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Finger {
    pub finger: usize,
    pub points: Vec<[f64; 3]>,
    pub barre: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandPlan {
    pub valid: bool,
    pub error: Option<String>,
    pub fingers: Vec<Finger>,
    pub palm: [f64; 3],
    pub forces: [f64; 6],
}
fn invalid(message: &str) -> HandPlan {
    HandPlan {
        valid: false,
        error: Some(message.into()),
        fingers: vec![],
        palm: [0.0; 3],
        forces: [0.0; 6],
    }
}
/// Non-real-time bounded geometric IK. Bone lengths are invariant; the elbow branch
/// stays above the strings and the distal joint flexes toward the board.
fn solve(frets: [i8; 6], assigned: [u8; 6], shift: f64, base_y: f64) -> HandPlan {
    if frets.iter().any(|&f| !(-1..=12).contains(&f)) {
        return invalid("Frets must be open, skipped, or 1–12.");
    }
    if frets
        .iter()
        .zip(assigned)
        .any(|(&f, a)| f > 0 && (a == 0 || a > 4))
    {
        return invalid("This shape needs more than four fretting fingers.");
    }
    let min = frets.iter().filter(|&&f| f > 0).min().copied().unwrap_or(1);
    let max = frets.iter().max().copied().unwrap_or(1);
    if max - min > 4 {
        return invalid("The fret span exceeds this hand’s reach.");
    }
    let cx = fret_x(min) - 0.012 + shift;
    // Positive instrument y becomes below the neck after the front-view rotation.
    let palm = [cx, base_y + 0.018, -0.012];
    let mut fingers = Vec::new();
    let mut forces = [0.0; 6];
    for finger in 1..=4 {
        let contacts: Vec<usize> = (0..6)
            .filter(|&i| frets[i] > 0 && assigned[i] == finger as u8)
            .collect();
        let lengths = match finger {
            1 => [0.044, 0.026, 0.019],
            2 => [0.048, 0.029, 0.020],
            3 => [0.045, 0.028, 0.020],
            _ => [0.036, 0.023, 0.018],
        };
        let barre = contacts.len() > 1;
        let mut base = [
            cx + (finger as f64 - 2.5) * 0.015,
            base_y,
            if finger == 4 { 0.030 } else { 0.018 },
        ];
        if contacts.is_empty() {
            // Unused fingers follow the metacarpal direction and curl back
            // toward the palm, outside the treble edge. Do not IK them toward
            // an invented string contact: that made idle fingers point and splay.
            let mut points = vec![base];
            let mut p = base;
            let along_x = -0.15;
            let along_y = -(1.0_f64 - along_x * along_x).sqrt();
            for (length, angle) in [
                (lengths[0], 85.0 * math::PI / 180.0),
                (lengths[1], -23.0 * math::PI / 180.0),
                (lengths[2], -98.0 * math::PI / 180.0),
            ] {
                let reach = length * math::cos(angle);
                p = [
                    p[0] + along_x * reach,
                    p[1] + along_y * reach,
                    p[2] + length * math::sin(angle),
                ];
                points.push(p);
            }
            fingers.push(Finger {
                finger,
                points,
                barre: false,
            });
            continue;
        }
        let i = contacts[0];
        let peers = (0..6)
            .filter(|&j| frets[j] == frets[i] && assigned[j] != finger as u8 && assigned[j] > 0)
            .count();
        let offset = if !barre && peers > 0 {
            0.004 + (4 - finger) as f64 * 0.008
        } else {
            0.006
        };
        let tip = [
            fret_x(frets[i]) - offset,
            string_y(i, fret_x(frets[i])),
            0.0095,
        ];
        if barre {
            let f = frets[contacts[0]];
            let from = *contacts.first().unwrap();
            let to = *contacts.last().unwrap();
            if contacts.iter().any(|&i| frets[i] != f)
                || (from..=to).any(|i| frets[i] == 0 || (frets[i] > 0 && frets[i] < f))
            {
                return invalid("A barre would touch an open or lower-fretted string.");
            }
            // The middle/distal pads lie across the strings. The proximal
            // phalanx rises off the treble edge to a flexed MCP, rather than
            // extending all three bones as one rigid rod through the palm.
            let [a, b, c] = lengths;
            let pip = [tip[0], tip[1] + b + c, tip[2]];
            let rise = 0.018;
            let spread = 0.008;
            base = [
                pip[0] + spread,
                pip[1] + (a * a - rise * rise - spread * spread).sqrt(),
                pip[2] + rise,
            ];
            let points = vec![base, pip, [tip[0], tip[1] + c, tip[2]], tip];
            fingers.push(Finger {
                finger,
                points,
                barre,
            });
        } else {
            let dx = tip[0] - base[0];
            let dy = tip[1] - base[1];
            let dz = tip[2] - base[2];
            let horizontal = math::hypot(dx, dy);
            let d = math::hypot(horizontal, dz);
            let dip = 0.65;
            let [a, b, c] = lengths;
            let bc = (b * b + c * c + 2.0 * b * c * math::cos(dip)).sqrt();
            if d > a + bc || d < (a - bc).abs() {
                return invalid("A fingertip cannot reach this fret within the joint limits.");
            }
            let heading = math::atan2(dz, horizontal);
            let upper =
                heading + math::acos(((a * a + d * d - bc * bc) / (2.0 * a * d)).clamp(-1.0, 1.0));
            let bend = math::acos(((a * a + bc * bc - d * d) / (2.0 * a * bc)).clamp(-1.0, 1.0));
            let effective = upper - (math::PI - bend);
            let middle = effective + math::atan2(c * math::sin(dip), b + c * math::cos(dip));
            // Generic adult PIP flexion envelope; no backwards hinge bend.
            if upper > math::PI / 2.0
                || upper - middle > 110.0 * math::PI / 180.0
                || upper - middle < 0.0
            {
                return invalid("The required finger bend exceeds the joint limits.");
            }
            let mut points = vec![base];
            let mut p = base;
            for (l, angle) in [(a, upper), (b, middle), (c, middle - dip)] {
                let r = l * math::cos(angle);
                p = [
                    p[0] + r * dx / horizontal,
                    p[1] + r * dy / horizontal,
                    p[2] + l * math::sin(angle),
                ];
                points.push(p);
            }
            fingers.push(Finger {
                finger,
                points,
                barre,
            });
        }
        for i in contacts {
            forces[i] = 3.0;
        }
    }
    // Thumb opposition: fixed CMC/MCP/IP lengths, bending behind the neck.
    let thumb_base = [palm[0] - 0.023, palm[1], palm[2]];
    let thumb_ip = [cx - 0.018, 0.019, -0.047];
    let delta = core::array::from_fn::<_, 3, _>(|i| thumb_ip[i] - thumb_base[i]);
    let distance = delta.iter().map(|v| v * v).sum::<f64>().sqrt();
    let axis = delta.map(|v| v / distance);
    let along = (0.045_f64.powi(2) - 0.035_f64.powi(2) + distance * distance) / (2.0 * distance);
    let mut bend = [-0.2, 0.0, -1.0];
    let projection = (0..3).map(|i| bend[i] * axis[i]).sum::<f64>();
    for i in 0..3 {
        bend[i] -= projection * axis[i];
    }
    let bend_length = bend.iter().map(|v| v * v).sum::<f64>().sqrt();
    let height = (0.045_f64.powi(2) - along * along).max(0.0).sqrt();
    let thumb_mcp =
        core::array::from_fn(|i| thumb_base[i] + along * axis[i] + height * bend[i] / bend_length);
    let thumb_tip = [cx, 0.003, -0.047];
    let hinge_angle = |a: [f64; 3], b: [f64; 3], c: [f64; 3]| {
        let u = core::array::from_fn::<_, 3, _>(|i| b[i] - a[i]);
        let v = core::array::from_fn::<_, 3, _>(|i| c[i] - b[i]);
        let dot = (0..3).map(|i| u[i] * v[i]).sum::<f64>();
        let length =
            (u.iter().map(|v| v * v).sum::<f64>() * v.iter().map(|v| v * v).sum::<f64>()).sqrt();
        math::acos((dot / length).clamp(-1.0, 1.0))
    };
    if hinge_angle(thumb_base, thumb_mcp, thumb_ip) > 70.0 * math::PI / 180.0
        || hinge_angle(thumb_mcp, thumb_ip, thumb_tip) > math::PI / 2.0
    {
        return invalid("The thumb bend exceeds this hand's joint limits.");
    }
    fingers.push(Finger {
        finger: 0,
        barre: false,
        points: vec![thumb_base, thumb_mcp, thumb_ip, thumb_tip],
    });
    // A barre moves with the palm: MCP heads keep their order and a bounded arch.
    for pair in fingers[..4].windows(2) {
        let a = pair[0].points[0];
        let b = pair[1].points[0];
        if !(0.014..=0.025).contains(&(b[0] - a[0]))
            || (b[1] - a[1]).abs() > 0.020
            || (b[2] - a[2]).abs() > 0.020
        {
            return invalid("The grip exceeds the palm's knuckle spacing limits.");
        }
    }
    // Anatomical hand frame: x across the MCP row, -y toward the fingertips,
    // +z toward the flexed knuckles. IP joints are hinges in each finger's plane.
    for finger in fingers.iter().filter(|f| f.finger > 0) {
        let p = &finger.points;
        let dx = p[1][0] - p[0][0];
        let dy = p[1][1] - p[0][1];
        let dz = p[1][2] - p[0][2];
        let spread = math::atan2(dx, -dy).abs();
        let flex = math::atan2(dz, math::hypot(dx, dy));
        let max_spread = [30.0, 20.0, 30.0, 40.0][finger.finger - 1] * math::PI / 180.0;
        if spread > max_spread
            || flex < -30.0 * math::PI / 180.0
            || flex > math::PI / 2.0
            || hinge_angle(p[0], p[1], p[2]) > 110.0 * math::PI / 180.0
            || hinge_angle(p[1], p[2], p[3]) > 80.0 * math::PI / 180.0
        {
            return invalid("A finger exceeds this hand's joint angle limits.");
        }
    }
    // Check the actual swept pad/phalange centre lines against every ringing
    // non-contact string, in instrument space (not projected screen space).
    for finger in fingers.iter().filter(|f| f.finger > 0) {
        for pair in finger.points.windows(2) {
            for step in 0..=32 {
                let t = step as f64 / 32.0;
                let p =
                    core::array::from_fn::<_, 3, _>(|i| pair[0][i] + (pair[1][i] - pair[0][i]) * t);
                if p[0] < 0.0 || p[0] > super::LENGTH {
                    continue;
                }
                for i in 0..6 {
                    if frets[i] < 0 || assigned[i] == finger.finger as u8 {
                        continue;
                    }
                    if finger.barre
                        && frets[i] > 0
                        && frets[i]
                            >= frets
                                .iter()
                                .zip(assigned)
                                .filter(|(_, a)| *a == finger.finger as u8)
                                .map(|(f, _)| *f)
                                .min()
                                .unwrap_or(12)
                    {
                        continue;
                    }
                    let distance = math::hypot(p[1] - string_y(i, p[0]), p[2] - 0.004);
                    if distance < 0.005 {
                        return invalid("A finger would mute a neighboring string.");
                    }
                }
            }
        }
    }
    for (i, a) in fingers.iter().filter(|f| f.finger > 0).enumerate() {
        for b in fingers.iter().filter(|f| f.finger > 0).skip(i + 1) {
            for pa in a.points.windows(2).skip(1) {
                for pb in b.points.windows(2).skip(1) {
                    for k in 0..=16 {
                        let t = k as f64 / 16.0;
                        let point = core::array::from_fn::<_, 3, _>(|j| {
                            pa[0][j] + (pa[1][j] - pa[0][j]) * t
                        });
                        let delta = core::array::from_fn::<_, 3, _>(|j| pb[1][j] - pb[0][j]);
                        let dot = (0..3)
                            .map(|j| (point[j] - pb[0][j]) * delta[j])
                            .sum::<f64>();
                        let length = delta.iter().map(|v| v * v).sum::<f64>();
                        let u = (dot / length).clamp(0.0, 1.0);
                        let distance = (0..3)
                            .map(|j| (point[j] - pb[0][j] - u * delta[j]).powi(2))
                            .sum::<f64>()
                            .sqrt();
                        if distance < 0.0065 {
                            return invalid("Two fretting fingers would intersect.");
                        }
                    }
                }
            }
        }
    }
    HandPlan {
        valid: true,
        error: None,
        fingers,
        palm,
        forces,
    }
}

/// Search a bounded set of wrist placements; never stretch a bone to reach.
pub fn plan(frets: [i8; 6], assigned: [u8; 6]) -> HandPlan {
    let mut result = invalid("No valid wrist placement.");
    for shift in [0.0, 0.01, 0.02, 0.03, -0.01, 0.04, 0.05] {
        for y in [0.062, 0.055, 0.048, 0.070] {
            result = solve(frets, assigned, shift, y);

            if result.valid {
                return result;
            }
        }
    }
    result
}
