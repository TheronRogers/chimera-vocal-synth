use chimera::analysis::fft::{hann, Fft};
use chimera::engine::Engine;
use chimera::guitar::{
    GuitarEvent, GuitarVoice, CAPACITY, OPEN_MIDI, STRING_COUNT, STRING_TELE_LEN, TELE_HEADER,
    TELE_LEN,
};

fn snapshot(v: &mut GuitarVoice) -> [f64; TELE_LEN] {
    let mut t = [0.0; TELE_LEN];
    v.telemetry(&mut t);
    t
}
fn render(v: &mut GuitarVoice, samples: usize) -> Vec<f32> {
    let mut x = vec![0.0; samples];
    v.render(&mut x);
    x
}
fn rms(x: &[f32]) -> f64 {
    (x.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt()
}
fn event(time: f64, frets: [i8; 6], direction: i8, step: u16) -> GuitarEvent {
    GuitarEvent {
        time,
        frets,
        direction,
        strength: 0.8,
        step,
    }
}

#[test]
fn every_string_and_fret_is_in_tune() {
    let fft = Fft::new(16384);
    let window = hann(fft.n);
    for fs in [44100.0, 48000.0] {
        for (string, midi) in OPEN_MIDI.iter().enumerate() {
            for fret in 0..=12 {
                let mut v = GuitarVoice::new(fs);
                v.set_fret(string, fret);
                v.pluck(string, 0.8);
                // Measure sustained pitch after the coupled body attack has decayed.
                render(&mut v, (fs * 0.3) as usize);
                let x = render(&mut v, fft.n);
                let mut re: Vec<f64> = x.iter().zip(&window).map(|(s, w)| *s as f64 * w).collect();
                let mut im = vec![0.0; fft.n];
                fft.transform(&mut re, &mut im);
                let expected = 440.0 * 2.0f64.powf((*midi as f64 + fret as f64 - 69.0) / 12.0);
                let center = expected * fft.n as f64 / fs;
                let power = |i: usize| (re[i] * re[i] + im[i] * im[i]).max(1e-30).ln();
                let k = ((center - 2.0) as usize..=(center + 2.0) as usize)
                    .max_by(|a, b| power(*a).total_cmp(&power(*b)))
                    .unwrap();
                let (left, middle, right) = (power(k - 1), power(k), power(k + 1));
                let delta = 0.5 * (left - right) / (left - 2.0 * middle + right);
                let frequency = (k as f64 + delta) * fs / fft.n as f64;
                let cents = 1200.0 * (frequency / expected).log2();
                assert!(
                    cents.abs() < 10.0,
                    "fs={fs}, string={string}, fret={fret}: {frequency}Hz, {cents} cents"
                );
                assert!(
                    rms(&x) > 0.00001,
                    "string {string} fret {fret} is inaudible"
                );
            }
        }
    }
}

#[test]
fn six_strings_ring_and_drive_a_decaying_body() {
    let mut v = GuitarVoice::new(48000.0);
    for (i, fret) in [0, 2, 2, 1, 0, 0].into_iter().enumerate() {
        v.set_fret(i, fret);
    }
    v.strum(1, 0.9);
    let first = render(&mut v, 12000);
    let t = snapshot(&mut v);
    assert!(rms(&first) > 0.002);
    assert!(t[8] > 0.001, "bridge forces did not excite the body");
    for i in 0..STRING_COUNT {
        assert!(t[TELE_HEADER + i * STRING_TELE_LEN + 6] > 0.0001);
    }
    render(&mut v, 48000);
    let late = render(&mut v, 12000);
    assert!(rms(&late) < rms(&first) * 0.6);
    assert!(first
        .iter()
        .chain(&late)
        .all(|x| x.is_finite() && x.abs() <= 1.0));
}

#[test]
fn held_mute_damps_without_pull_and_does_not_repluck_on_release() {
    let mut v = GuitarVoice::new(48000.0);
    v.pluck(0, 1.0);
    let attack = rms(&render(&mut v, 6000));
    let before = snapshot(&mut v)[TELE_HEADER + 5];
    v.set_mute(0, true);
    v.pluck(0, 1.0);
    render(&mut v, 12000);
    let muted = snapshot(&mut v);
    assert_eq!(muted[TELE_HEADER + 1], 1.0);
    assert_eq!(muted[TELE_HEADER + 2], 0.0);
    assert!(muted[TELE_HEADER + 5] < before * 0.01);
    v.set_mute(0, false);
    let tail = rms(&render(&mut v, 4800));
    assert!(
        tail < attack * 0.6,
        "release must not excite a new note; attack={attack}, tail={tail}"
    );
    v.hard_reset();
    v.set_mute(0, true);
    render(&mut v, 128);
    v.set_mute(0, false);
    assert!(
        render(&mut v, 4096).iter().all(|x| *x == 0.0),
        "touch/release excited a silent string"
    );
}

#[test]
fn excluded_strings_and_held_mutes_survive_strums_and_chord_changes() {
    let mut v = GuitarVoice::new(48000.0);
    v.set_mute(1, true);
    v.load_score(
        &[event(0.0, [-1, 2, 2, 1, 0, 0], 1, 0)],
        0.05,
        0.5,
        false,
        120.0,
    );
    render(&mut v, 12000);
    let t = snapshot(&mut v);
    for i in [0, 1] {
        assert_eq!(t[TELE_HEADER + i * STRING_TELE_LEN + 5], 0.0);
    }
    for i in 2..6 {
        assert!(t[TELE_HEADER + i * STRING_TELE_LEN + 5] > 0.0);
    }
}

#[test]
fn scheduled_release_is_exact_and_strum_order_is_sample_clocked() {
    for direction in [1, -1] {
        let mut v = GuitarVoice::new(48000.0);
        v.load_score(&[event(0.0, [0; 6], direction, 2)], 0.1, 0.5, false, 120.0);
        assert!(
            render(&mut v, 4800).iter().all(|x| *x == 0.0),
            "audio preceded scheduled beat"
        );
        let before = snapshot(&mut v);
        let first = if direction > 0 { 0 } else { 5 };
        let last = 5 - first;
        assert_eq!(before[TELE_HEADER + first * STRING_TELE_LEN + 2], 1.0);
        render(&mut v, 1);
        let t = snapshot(&mut v);
        assert_eq!(t[TELE_HEADER + first * STRING_TELE_LEN + 2], 0.0);
        assert_eq!(t[10], 0.1);
        render(&mut v, 1919);
        let before_last = snapshot(&mut v);
        assert_eq!(before_last[TELE_HEADER + last * STRING_TELE_LEN + 2], 1.0);
        render(&mut v, 1);
        assert_eq!(
            snapshot(&mut v)[TELE_HEADER + last * STRING_TELE_LEN + 2],
            0.0
        );
    }
}

#[test]
fn chord_only_events_do_not_block_preparation_or_revert_the_next_loop_chord() {
    let mut v = GuitarVoice::new(48000.0);
    v.load_score(
        &[
            event(0.0, [-1, 0, 2, 2, 1, 0], 0, 0),
            event(0.0, [-1, 0, 2, 2, 1, 0], 1, 0),
            event(0.19, [5; 6], 0, 1),
        ],
        0.05,
        0.2,
        true,
        150.0,
    );
    assert!(render(&mut v, 2400).iter().all(|x| *x == 0.0));
    let prepared = snapshot(&mut v);
    assert_eq!(prepared[TELE_HEADER + STRING_TELE_LEN + 2], 1.0);
    assert_eq!(prepared[TELE_HEADER + 5], 0.0);
    render(&mut v, 1);
    assert_eq!(
        snapshot(&mut v)[TELE_HEADER + STRING_TELE_LEN + 2],
        0.0,
        "first included string did not release on the beat"
    );
    render(&mut v, 9120);
    let next_loop = snapshot(&mut v);
    assert_eq!(
        next_loop[TELE_HEADER], -1.0,
        "late chord-only event reverted the next loop's prepared chord"
    );
    assert_eq!(next_loop[TELE_HEADER + STRING_TELE_LEN + 2], 1.0);
    render(&mut v, 480);
    assert_eq!(snapshot(&mut v)[TELE_HEADER + STRING_TELE_LEN + 2], 0.0);
}

#[test]
fn repeated_chord_contacts_remain_finite_and_bounded() {
    let mut v = GuitarVoice::new(44100.0);
    let mut block = [0.0; 257];
    for step in 0..500 {
        for string in 0..6 {
            v.set_fret(string, ((step + string * 3) % 14) as i8 - 1);
            v.set_mute(string, (step + string) % 9 == 0);
        }
        v.strum(if step % 2 == 0 { 1 } else { -1 }, 1.0);
        v.render(&mut block);
        assert!(block.iter().all(|x| x.is_finite() && x.abs() <= 1.0));
        let t = snapshot(&mut v);
        assert!(t.iter().all(|x| x.is_finite()));
        for string in 0..6 {
            assert!(t[TELE_HEADER + string * STRING_TELE_LEN + 5] < 0.1);
        }
    }
}

#[test]
fn scores_loop_replace_stop_and_reject_invalid_events() {
    let mut v = GuitarVoice::new(48000.0);
    let mut events = [event(0.0, [0; 6], 1, 1), event(0.2, [2; 6], -1, 2)];
    v.load_score(&events, 0.05, 0.4, true, 150.0);
    render(&mut v, 24000);
    let t = snapshot(&mut v);
    assert_eq!(t[2], 1.0);
    assert_eq!(t[3], 1.0);
    assert_eq!(t[5], 1.0);
    events[0] = event(0.0, [3; 6], 0, 8);
    v.load_score(&events[..1], v.clock(), 0.1, false, 90.0);
    render(&mut v, 1);
    let t = snapshot(&mut v);
    assert_eq!(t[3], 8.0);
    assert_eq!(t[TELE_HEADER], 3.0);
    v.stop();
    render(&mut v, 1000);
    assert!(render(&mut v, 4096).iter().all(|x| *x == 0.0));
    assert_eq!(snapshot(&mut v)[2], 0.0);
    let mut too_many = vec![event(0.0, [0; 6], 0, 0); CAPACITY + 2];
    too_many[0].time = f64::NAN;
    v.load_score(&too_many, v.clock(), 1.0, false, f64::NAN);
    let t = snapshot(&mut v);
    assert_eq!(t[11], CAPACITY as f64);
    assert_eq!(t[12], 2.0);
    v.set_fret(99, 127);
    v.set_mute(99, true);
    v.pluck(99, f64::INFINITY);
    v.pluck(0, f64::NAN);
    v.strum(1, f64::NAN);
    assert!(render(&mut v, 4096).iter().all(|x| x.is_finite()));
}

#[test]
fn stop_fade_finishes_without_cancelling_a_queued_restart() {
    let mut v = GuitarVoice::new(48000.0);
    v.strum(1, 0.9);
    render(&mut v, 6000);
    v.stop();
    v.load_score(
        &[event(0.0, [0; 6], 1, 0)],
        v.clock() + 0.1,
        0.5,
        false,
        120.0,
    );
    render(&mut v, 500);
    assert!(
        render(&mut v, 4000).iter().all(|x| *x == 0.0),
        "queued restart cancelled Stop's fade"
    );
    assert_eq!(
        snapshot(&mut v)[2],
        1.0,
        "Stop's fade cancelled the queued score"
    );
    assert!(rms(&render(&mut v, 6000)) > 0.002);
}

#[test]
fn held_mute_survives_stop_and_both_immediate_and_queued_restarts() {
    for lead in [0.0, 0.1] {
        let mut v = GuitarVoice::new(48000.0);
        v.strum(1, 0.9);
        render(&mut v, 6000);
        v.set_mute(0, true);
        v.stop();
        v.load_score(
            &[event(0.0, [0; 6], 1, 0), event(0.15, [2; 6], -1, 1)],
            v.clock() + lead,
            0.3,
            true,
            120.0,
        );
        render(&mut v, 24000);
        v.pluck(0, 1.0);
        v.strum(1, 1.0);
        render(&mut v, 4800);
        let t = snapshot(&mut v);
        assert_eq!(
            t[TELE_HEADER + 1],
            1.0,
            "restart with lead={lead} released held mute"
        );
        assert_eq!(t[TELE_HEADER + 2], 0.0);
        assert_eq!(t[TELE_HEADER + 5], 0.0, "muted string was retriggered");
        assert!(t[TELE_HEADER + STRING_TELE_LEN + 5] > 0.0);
        v.hard_reset();
        assert_eq!(
            snapshot(&mut v)[TELE_HEADER + 1],
            0.0,
            "hard reset must release contacts"
        );
    }
}

#[test]
fn combined_guitar_and_singer_render_is_block_independent() {
    let run = |block: usize| {
        let mut e = Engine::new(48000.0);
        e.set_gate(0.8);
        e.set_guitar(true);
        e.guitar.load_score(
            &[event(0.0, [0, 2, 2, 1, 0, 0], 1, 0)],
            0.03,
            0.25,
            true,
            120.0,
        );
        let mut out = vec![0.0; 12000];
        for b in out.chunks_mut(block) {
            e.render(b);
        }
        out
    };
    let reference = run(128);
    for size in [1, 37, 512, 12000] {
        assert_eq!(reference, run(size), "combined block {size}");
    }
}

#[test]
fn scores_and_telemetry_are_block_independent() {
    let run = |block: usize| {
        let mut v = GuitarVoice::new(48000.0);
        v.load_score(
            &[
                event(0.0, [0, 2, 2, 1, 0, 0], 1, 0),
                event(0.125, [-1, 0, 2, 2, 1, 0], -1, 1),
            ],
            0.03,
            0.25,
            true,
            120.0,
        );
        let mut out = vec![0.0; 24000];
        for b in out.chunks_mut(block) {
            v.render(b);
            snapshot(&mut v);
        }
        out
    };
    let reference = run(128);
    for n in [1, 37, 512, 24000] {
        assert_eq!(reference, run(n), "block {n}");
    }
}

#[test]
fn guitar_and_singer_share_rendering_without_changing_voice_only_audio() {
    let mut solo = Engine::new(48000.0);
    let mut combined = Engine::new(48000.0);
    solo.set_gate(0.8);
    combined.set_gate(0.8);
    combined.set_guitar(true);
    combined.set_guitar_levels(0.0, 1.0);
    combined.guitar.strum(1, 1.0);
    let (mut a, mut b) = ([0.0; 128], [0.0; 128]);
    for _ in 0..80 {
        solo.render(&mut a);
        combined.render(&mut b);
        assert_eq!(a, b);
    }
    assert_eq!(solo.clock(), combined.clock());
    assert!((combined.guitar.clock() - combined.clock()).abs() < 1e-12);
    combined.set_guitar_levels(0.7, 0.8);
    combined.guitar.strum(-1, 1.0);
    for _ in 0..100 {
        combined.render(&mut b);
        assert!(b.iter().all(|x| x.is_finite() && x.abs() <= 1.0));
    }
    assert!(b.iter().any(|x| x.abs() > 0.001));
}

mod common;
#[test]
fn guitar_sound_golden() {
    let mut audio = Vec::new();
    for fs in [44100.0, 48000.0] {
        let mut v = GuitarVoice::new(fs);
        v.load_score(
            &[
                event(0.0, [0, 2, 2, 1, 0, 0], 1, 0),
                event(0.18, [-1, 0, 2, 2, 1, 0], -1, 1),
            ],
            0.03,
            0.5,
            false,
            120.0,
        );
        let mut block = [0.0; 128];
        for i in 0..200 {
            match i {
                100 => v.set_mute(2, true),
                120 => v.set_mute(2, false),
                140 => v.pluck(2, 0.65),
                175 => v.stop(),
                _ => {}
            }
            v.render(&mut block);
            audio.extend_from_slice(&block);
        }
    }
    if common::blessing() {
        common::save_f32("guitar", &audio);
    } else {
        assert_eq!(
            common::load_f32("guitar"),
            audio,
            "guitar sound changed; review before blessing"
        );
    }
}

#[test]
fn plate_basis_and_reciprocal_bridge_are_live() {
    let data = chimera::guitar::body::data();
    assert_eq!(data.modes.len(), 16);
    for mode in &data.modes {
        assert!(mode.hz > 0.0 && mode.hz < 4000.0);
        assert_eq!(mode.shape.len(), data.nodes.len());
    }
    let mut v = GuitarVoice::new(48000.0);
    v.pluck(0, 0.8);
    render(&mut v, 12000);
    let t = snapshot(&mut v);
    assert!(
        t[16..48].iter().any(|x| x.abs() > 1e-10),
        "no soundboard motion"
    );
    assert!(t[14].abs() > 1e-12, "no cavity response");
    assert!(t[62].abs() > 1e-12, "no back plate motion");
    assert!(
        t[TELE_HEADER + STRING_TELE_LEN + 5] > 1e-10,
        "bridge did not excite an unplucked string"
    );
}
#[test]
fn articulated_presets_grip_from_below_with_fixed_bones_and_thumb_behind_neck() {
    use chimera::guitar::geometry::plan;
    for (frets, fingers) in [
        ([-1, 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0]),
        ([-1, -1, 0, 2, 3, 2], [0, 0, 0, 1, 3, 2]),
        ([0, 2, 2, 1, 0, 0], [0, 2, 3, 1, 0, 0]),
        ([3, 2, 0, 0, 0, 3], [2, 1, 0, 0, 0, 3]),
        ([-1, 0, 2, 2, 2, 0], [0, 0, 1, 2, 3, 0]),
        ([-1, 0, 2, 2, 1, 0], [0, 0, 2, 3, 1, 0]),
        ([-1, -1, 0, 2, 3, 1], [0, 0, 0, 2, 3, 1]),
        ([0, 2, 2, 0, 0, 0], [0, 2, 3, 0, 0, 0]),
        ([1, 3, 3, 2, 1, 1], [1, 3, 4, 2, 1, 1]),
        ([-1, 2, 4, 4, 3, 2], [0, 1, 3, 4, 2, 1]),
    ] {
        let p = plan(frets, fingers);
        assert!(p.valid, "{:?}: {:?}", frets, p.error);
        // The renderer turns the instrument through PI: positive y is below the neck.
        assert!(p.palm[1] > 0.02225);
        for f in &p.fingers {
            assert!(
                f.points[0][1] > 0.02225,
                "finger {} starts above neck",
                f.finger
            );
            if f.finger == 0 {
                for (pair, length) in f.points.windows(2).zip([
                    0.045,
                    0.035,
                    (0.018_f64.powi(2) + 0.016_f64.powi(2)).sqrt(),
                ]) {
                    let distance = (0..3)
                        .map(|i| (pair[1][i] - pair[0][i]).powi(2))
                        .sum::<f64>()
                        .sqrt();
                    assert!(
                        (distance - length).abs() < 1e-9,
                        "thumb bones must not stretch"
                    );
                }
                continue;
            }
            let contacts: Vec<_> = (0..6)
                .filter(|&i| frets[i] > 0 && fingers[i] as usize == f.finger)
                .collect();
            if contacts.is_empty() {
                assert!(
                    f.points.iter().all(|p| p[1] > 0.02225),
                    "unused finger {} must rest outside the treble edge",
                    f.finger
                );
                assert!(
                    f.points.last().unwrap()[0] < f.points[0][0],
                    "unused fingers follow the palm toward the nut"
                );
            }
            if let Some(&i) = contacts.first() {
                let tip = f.points.last().unwrap();
                assert!(
                    (tip[1] - chimera::guitar::geometry::string_y(i, tip[0])).abs() < 0.0005,
                    "{frets:?}, finger {} tip {tip:?}",
                    f.finger
                );
                assert!((tip[2] - 0.0095).abs() < 1e-9);
            }
        }
        assert!(
            p.fingers
                .iter()
                .find(|f| f.finger == 0)
                .unwrap()
                .points
                .last()
                .unwrap()[2]
                < -0.04
        );
        for f in p.fingers.iter().filter(|f| f.finger > 0) {
            if f.barre {
                assert!(
                    f.points[0][2] - f.points[1][2] > 0.015,
                    "the barre MCP must flex above the flat contact pads"
                );
                assert!((f.points[1][2] - f.points[3][2]).abs() < 1e-9);
                assert!(f.points[1][1] > 0.02225, "barre PIP clears the treble edge");
            }
            let lengths = match f.finger {
                1 => [0.044, 0.026, 0.019],
                2 => [0.048, 0.029, 0.020],
                3 => [0.045, 0.028, 0.020],
                _ => [0.036, 0.023, 0.018],
            };
            for (pair, length) in f.points.windows(2).zip(lengths) {
                let d = (0..3)
                    .map(|i| (pair[1][i] - pair[0][i]).powi(2))
                    .sum::<f64>()
                    .sqrt();
                assert!((d - length).abs() < 1e-9);
            }
        }
    }
    assert!(!plan([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 0, 0]).valid);
    assert!(!plan([1, 0, 1, 0, 0, 0], [1, 0, 1, 0, 0, 0]).valid);
}

#[test]
fn f_uses_one_index_barre_across_all_six_strings() {
    use chimera::guitar::geometry::{plan, string_y};
    let p = plan([1, 3, 3, 2, 1, 1], [1, 3, 4, 2, 1, 1]);
    assert!(p.valid, "{:?}", p.error);
    let index = p.fingers.iter().find(|f| f.finger == 1).unwrap();
    assert!(index.barre);
    assert_eq!(p.fingers.iter().filter(|f| f.barre).count(), 1);
    let pip = index.points[1];
    let tip = index.points[3];
    for string in 0..6 {
        let y = string_y(string, tip[0]);
        assert!(
            y >= tip[1] - 0.0005 && y <= pip[1],
            "index misses string {string}"
        );
    }
    assert!((pip[0] - tip[0]).abs() < 1e-9);
    assert!((pip[2] - tip[2]).abs() < 1e-9);
    assert!(index.points[0][2] > pip[2]);
    assert!(plan([0; 6], [0; 6]).valid, "all-open grip rests naturally");
}

#[test]
fn live_grip_waits_for_pressure_and_changes_it_without_repluck() {
    let mut v = GuitarVoice::new(48000.0);
    v.set_shape([1, 0, 0, 0, 0, 0], 1.0);
    v.strum(1, 0.8);
    assert!(render(&mut v, 4800).iter().all(|x| *x == 0.0));
    render(&mut v, 1);
    assert_eq!(snapshot(&mut v)[TELE_HEADER], 1.0);
    render(&mut v, 2400);
    assert!(snapshot(&mut v)[TELE_HEADER + 5] > 0.0);
    v.stop();
    render(&mut v, 480);
    v.set_shape([1, 0, 0, 0, 0, 0], 0.1);
    render(&mut v, 4801);
    let t = snapshot(&mut v);
    assert_eq!(t[TELE_HEADER], 0.0);
    assert!((t[56] - 0.3).abs() < 1e-12);
    assert_eq!(t[TELE_HEADER + 2], 0.0);
}

#[test]
fn stroke_telemetry_follows_the_pending_grip_and_cancels_muted_contacts() {
    let mut v = GuitarVoice::new(48000.0);
    v.set_fret(0, -1);
    v.set_shape([0, -1, 0, 0, 0, 0], 1.0);
    v.set_mute(3, true);
    v.strum(1, 0.8);
    let t = snapshot(&mut v);
    let times = &t[64..70];
    assert_eq!(times[1], -1.0);
    assert_eq!(times[3], -1.0);
    assert!((times[2] - times[0] - 0.008).abs() < 1e-12);
    assert!((times[4] - times[2] - 0.008).abs() < 1e-12);
    render(&mut v, 6001);
    assert!(snapshot(&mut v)[TELE_HEADER + 6] > 0.0);

    v.strum(-1, 0.8);
    let t = snapshot(&mut v);
    assert!((t[64] - t[69] - 0.024).abs() < 1e-12);
    v.set_mute(4, true);
    assert_eq!(snapshot(&mut v)[68], -1.0);
    v.stop();
    assert_eq!(&snapshot(&mut v)[64..70], &[-1.0; 6]);
}

#[test]
fn instrument_presets_change_tone_independently_and_preserve_held_mutes() {
    use chimera::guitar::instrument::{BODIES, STRINGS};

    let strum = |body, strings| {
        let mut voice = GuitarVoice::new(48000.0);
        voice.set_mute(5, true);
        voice.set_instrument(body, strings);
        render(&mut voice, 2);
        voice.strum(1, 0.65);
        let audio = render(&mut voice, 24000);
        assert!(audio.iter().all(|x| x.is_finite() && x.abs() < 1.0));
        assert!(rms(&audio) > 0.01);
        assert_eq!(snapshot(&mut voice)[TELE_HEADER + 5 * STRING_TELE_LEN + 1], 1.0);
        audio
    };

    // First-difference energy relative to signal energy weights high harmonics
    // and rejects gain changes. Compare the tail after every string has released.
    let brightness = |audio: &[f32]| {
        let tail = &audio[7200..];
        let energy = tail.windows(2).map(|pair| (pair[1] as f64 - pair[0] as f64).powi(2))
            .sum::<f64>();
        (energy / tail.len() as f64).sqrt() / rms(tail)
    };
    let reference = strum(0, 0);
    let reference_rms = rms(&reference);
    for body in 1..BODIES.len() {
        let audio = strum(body, 0);
        let level = rms(&audio);
        let difference = audio.iter().zip(&reference)
            .map(|(a, b)| (*a as f64 / level - *b as f64 / reference_rms).powi(2))
            .sum::<f64>();
        assert!((difference / audio.len() as f64).sqrt() > 0.18, "body {body}");
    }

    // With the same strings, flat tops should retain more attack and brightness
    // than the classical and archtop voicings.
    let mellow = brightness(&strum(4, 0)).max(brightness(&strum(5, 0)));
    for body in 0..4 {
        let bright = brightness(&strum(body, 0));
        assert!(bright > mellow * 1.10, "body {body}: {bright} vs {mellow}");
    }

    let string_brightness: Vec<_> = (0..STRINGS.len())
        .map(|strings| brightness(&strum(0, strings)))
        .collect();
    assert!(string_brightness[1] > string_brightness[0] * 1.08, "{string_brightness:?}");
    for strings in [2, 3, 4] {
        assert!(string_brightness[strings] < string_brightness[0] * 0.92, "{string_brightness:?}");
    }
}

#[test]
fn electric_pickup_changes_the_signal_without_moving_the_string() {
    use chimera::guitar::Pickup;
    let play = |pickup, position| {
        let mut voice = GuitarVoice::new(48000.0);
        voice.set_pickup(pickup, position);
        voice.pluck(0, 0.8);
        let audio = render(&mut voice, 8192);
        assert!(rms(&audio) > 0.001);
        assert!(audio.iter().all(|x| x.is_finite() && x.abs() < 1.0));
        let state = snapshot(&mut voice);
        (audio, state[TELE_HEADER + 7..TELE_HEADER + STRING_TELE_LEN].to_vec())
    };
    let (neck, string) = play(Pickup::SingleCoil, 0.73);
    let (bridge, same_string) = play(Pickup::SingleCoil, 0.94);
    let (humbucker, same_again) = play(Pickup::Humbucker, 0.94);
    assert_eq!(string, same_string);
    assert_eq!(string, same_again);
    assert_ne!(neck, bridge);
    assert_ne!(bridge, humbucker);
}

#[test]
fn strum_position_moves_the_contact_and_changes_the_vibration() {
    use chimera::guitar::Pickup;
    let play = |position| {
        let mut voice = GuitarVoice::new(48000.0);
        voice.set_pickup(Pickup::SingleCoil, 0.86);
        voice.set_strum_position(position);
        voice.set_fret(0, 12);
        voice.strum(1, 0.8);
        let _ = render(&mut voice, 1000);
        let pulling = snapshot(&mut voice);
        assert_eq!(pulling[TELE_HEADER + 2], 1.0);
        assert!((pulling[TELE_HEADER + 3] - position).abs() < 0.004);
        let audio = render(&mut voice, 8192);
        assert!(rms(&audio) > 0.001);
        let ringing = snapshot(&mut voice);
        ringing[TELE_HEADER + 7..TELE_HEADER + STRING_TELE_LEN].to_vec()
    };
    assert_ne!(play(0.72), play(0.96));
}

#[test]
fn bass_has_four_octave_lower_strings_and_restores_guitar_tuning() {
    use chimera::guitar::{BASS_OPEN_MIDI, Pickup};
    let fs = 48000.0;
    let fft = Fft::new(32768);
    let window = hann(fft.n);
    let mut voice = GuitarVoice::new(fs);
    voice.set_pickup(Pickup::Humbucker, 0.76);
    voice.set_bass(true);
    voice.set_fret(4, 0);
    voice.pluck(4, 1.0);
    assert_eq!(rms(&render(&mut voice, 8000)), 0.0);

    let mut check_pitch = |bass: bool, string: usize, midi: u8| {
        voice.hard_reset();
        voice.set_bass(bass);
        voice.set_fret(string, 0);
        voice.pluck(string, 0.8);
        render(&mut voice, 6000);
        let samples = render(&mut voice, fft.n);
        assert!(rms(&samples) > 0.00001);
        let mut re: Vec<f64> = samples.iter().zip(&window).map(|(s, w)| *s as f64 * w).collect();
        let mut im = vec![0.0; fft.n];
        fft.transform(&mut re, &mut im);
        let expected = 440.0 * 2.0f64.powf((midi as f64 - 69.0) / 12.0);
        let center = (expected * fft.n as f64 / fs).round() as usize;
        let power = |i: usize| re[i].powi(2) + im[i].powi(2);
        assert!(power(center).max(power(center + 1)).max(power(center - 1)) > 0.001);
        assert!(power(center).max(power(center + 1)).max(power(center - 1)) > power(center / 2) * 20.0);
    };
    for (string, midi) in BASS_OPEN_MIDI.into_iter().enumerate() {
        check_pitch(true, string, midi);
    }
    check_pitch(false, 0, OPEN_MIDI[0]);
    check_pitch(false, 4, OPEN_MIDI[4]);
}
