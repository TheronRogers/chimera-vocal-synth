use chimera::guitar::{GuitarVoice, TELE_LEN};

fn render(fs: f64, fretted: bool, position: f64) -> Vec<f32> {
    let mut v = GuitarVoice::new(fs);
    v.fret(if fretted { 1.0 } else { 0.0 });
    v.contact(position, 0.002, true);
    v.render(&mut vec![0.0; (fs * 0.08) as usize]);
    v.release();
    let mut out = vec![0.0; fs as usize];
    v.render(&mut out);
    out
}
fn power(x: &[f32], fs: f64, frequency: f64) -> f64 {
    let (mut re, mut im) = (0.0, 0.0);
    for (i, s) in x.iter().enumerate() {
        let a = 2.0 * std::f64::consts::PI * frequency * i as f64 / fs;
        let window = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / x.len() as f64).cos();
        re += *s as f64 * window * a.cos();
        im += *s as f64 * window * a.sin();
    }
    re * re + im * im
}
#[test]
fn pitch_and_decay() {
    for fs in [44100.0, 48000.0] {
        for fret in [false, true] {
            let x = render(fs, fret, 0.8);
            let expected = 82.41 * if fret { 2.0f64.powf(1.0 / 12.0) } else { 1.0 };
            let best = (0..81)
                .map(|i| expected - 2.0 + i as f64 * 0.05)
                .max_by(|a, b| power(&x, fs, *a).total_cmp(&power(&x, fs, *b)))
                .unwrap();
            let cents = 1200.0 * (best / expected).log2();
            assert!(
                cents.abs() < 10.0,
                "{fs} fretted={fret}: {best} Hz ({cents} cents)"
            );
            let rms = |s: &[f32]| {
                (s.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / s.len() as f64).sqrt()
            };
            assert!(rms(&x[..x.len() / 4]) > rms(&x[3 * x.len() / 4..]) * 1.5);
        }
    }
}
#[test]
fn plucking_position_changes_harmonics() {
    let middle = render(48000.0, false, 0.5);
    let quarter = render(48000.0, false, 0.25);
    let ratio = |x: &[f32]| power(x, 48000.0, 164.82) / power(x, 48000.0, 82.41);
    assert!(ratio(&quarter) > ratio(&middle) * 20.0);
}
#[test]
fn contacts_damp_and_remain_bounded() {
    let mut v = GuitarVoice::new(44100.0);
    let mut b = [0.0; 1024];
    let mut t = [0.0; TELE_LEN];
    v.pluck();
    v.render(&mut b);
    v.release();
    v.render(&mut b);
    v.telemetry(&mut t);
    let before = t[6];
    v.contact(0.8, 0.0, true);
    for _ in 0..200 {
        v.render(&mut b);
    }
    v.telemetry(&mut t);
    assert!(t[6] < before * 0.25);
    for i in 0..500 {
        v.fret((i % 3) as f64 * 0.5);
        v.contact(
            0.2 + (i % 70) as f64 / 100.0,
            if i % 2 == 0 { 0.004 } else { -0.004 },
            true,
        );
        v.render(&mut b[..137]);
        v.release();
        v.render(&mut b);
        assert!(b.iter().all(|s| s.is_finite() && s.abs() <= 1.0));
        v.telemetry(&mut t);
        assert!(t.iter().all(|x| x.is_finite()));
        assert!(t[6] < 0.1, "unbounded displacement {}", t[6]);
    }
    v.contact(f64::NAN, f64::INFINITY, true);
    v.fret(f64::NAN);
    v.mute();
    v.render(&mut b);
    assert!(b.iter().all(|x| *x == 0.0));
}
#[test]
fn block_sizes_and_snapshots_do_not_change_audio() {
    let run = |block: usize| {
        let mut v = GuitarVoice::new(48000.0);
        v.fret(1.0);
        v.pluck();
        let mut out = vec![0.0; 24000];
        let mut t = [0.0; TELE_LEN];
        for b in out.chunks_mut(block) {
            v.render(b);
            v.telemetry(&mut t);
        }
        out
    };
    let reference = run(128);
    for n in [1, 37, 512, 24000] {
        assert_eq!(reference, run(n), "block {n}");
    }
}

#[test]
fn light_fret_touch_dissipates_vibration() {
    let energy = |pressure: f64| {
        let mut v = GuitarVoice::new(48000.0);
        let mut b = [0.0; 1024];
        v.pluck();
        for _ in 0..5 {
            v.render(&mut b);
        }
        v.fret(pressure);
        for _ in 0..60 {
            v.render(&mut b);
        }
        b.iter().map(|x| (*x as f64).powi(2)).sum::<f64>()
    };
    let light = energy(0.15);
    let open = energy(0.0);
    assert!(light < open * 0.8, "light={light}, open={open}");
}

mod common;

#[test]
fn guitar_sound_golden() {
    let mut audio = Vec::new();
    for fs in [44100.0, 48000.0] {
        let mut v = GuitarVoice::new(fs);
        let mut block = [0.0; 128];
        for i in 0..160 {
            match i {
                0 | 80 => v.pluck(),
                45 => v.fret(1.0),
                100 => v.fret(0.15),
                110 => v.contact(0.6, -0.002, true),
                125 => v.release(),
                150 => v.mute(),
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
