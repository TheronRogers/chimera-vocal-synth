use chimera::drums::RockKit;

#[test]
fn every_surface_rings_and_decays_without_nonfinite_output() {
    for fs in [44100.0, 48000.0] {
        for id in 0..8 {
            let mut kit = RockKit::new(fs);
            kit.set(true, 0.5);
            kit.hit(id, 0.8);
            let mut early = 0.0;
            let mut late = 0.0;
            for i in 0..(fs * 5.0) as usize {
                let x = kit.sample();
                assert!(x.is_finite() && x.abs() < 1.0, "surface {id}: {x}");
                if i < 4800 {
                    early += x * x;
                }
                if i > (fs * 4.8) as usize {
                    late += x * x;
                }
            }
            assert!(early > 0.0001, "surface {id} silent");
            assert!(
                late < early * 0.01,
                "surface {id} did not decay: {late}/{early}"
            );
            kit.stop();
            assert_eq!(kit.sample(), 0.0);
        }
    }
}

fn render(block: usize) -> Vec<f64> {
    let mut kit = RockKit::new(48000.0);
    kit.set(true, 0.5);
    kit.schedule(0.0, 0.05, 1.0, true, 120.0);
    let mut out = Vec::new();
    while out.len() < 120000 {
        for _ in 0..block.min(120000 - out.len()) {
            out.push(kit.sample());
        }
    }
    out
}
#[test]
fn groove_is_block_independent_and_starts_at_the_scheduled_sample() {
    let samples = render(1);
    assert_eq!(samples, render(128));
    assert_eq!(samples, render(317));
    assert!(samples[..2400].iter().all(|&x| x == 0.0));
    assert!(samples[2400..2600].iter().any(|x| x.abs() > 0.001));
    assert!(samples[50400..51000].iter().any(|x| x.abs() > 0.001));
}
#[test]
fn disabled_and_invalid_controls_stay_silent() {
    let mut kit = RockKit::new(48000.0);
    kit.hit(1, 1.0);
    assert_eq!(kit.sample(), 0.0);
    kit.set(true, 0.5);
    kit.hit(99, 1.0);
    kit.hit(0, f64::NAN);
    assert_eq!(kit.sample(), 0.0);
    kit.hit(0, 1.0);
    kit.set(false, 0.5);
    assert_eq!(kit.sample(), 0.0);
    kit.set(true, 0.5);
    assert_eq!(kit.sample(), 0.0);
}

#[test]
fn physical_kit_sound_golden() {
    let mut bytes = Vec::new();
    for fs in [44100.0, 48000.0] {
        let mut kit = RockKit::new(fs);
        kit.set(true, 0.5);
        for block in 0..256 {
            if block % 32 == 0 {
                kit.hit(block / 32, 0.8);
            }
            for _ in 0..128 {
                bytes.extend_from_slice(&(kit.sample() as f32).to_le_bytes());
            }
        }
    }
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/drums.f32");
    if std::env::var_os("CHIMERA_BLESS").is_some() {
        std::fs::write(path, &bytes).unwrap();
    }
    assert_eq!(
        bytes,
        std::fs::read(path).expect("bless the physical drum fixture")
    );
}

#[test]
fn queued_strikes_predict_contact_and_stop_cancels_pending_hits() {
    use chimera::drums::DRUM_TELE_LEN;
    let mut kit = RockKit::new(48000.0);
    kit.set(true, 0.5);
    kit.queue_hit(1, 0.8, 0.28);
    kit.queue_hit(4, 0.8, 0.28);
    kit.queue_hit(0, 0.8, 0.28);
    let mut t = [0.0; DRUM_TELE_LEN];
    kit.telemetry(&mut t);
    assert_eq!(t[9], 0.28);
    assert_eq!(t[8], 0.28, "kick foot must be independent of either hand");
    assert!(t[12] >= 0.40); // same-hand requests reserve distinct strikes
    for _ in 0..13440 {
        assert_eq!(kit.sample(), 0.0);
    }
    kit.sample();
    kit.telemetry(&mut t);
    assert_eq!(t[17], 0.28);
    for _ in 0..1000 {
        kit.sample();
    }
    kit.telemetry(&mut t);
    assert!(t[7] > 0.0, "snare wire telemetry is silent");
    assert!(
        t[36..40].iter().any(|v| v.abs() > 1e-5),
        "snare membrane not moving"
    );
    kit.stop();
    for _ in 0..30000 {
        assert_eq!(kit.sample(), 0.0);
    }
    kit.telemetry(&mut t);
    assert!(t[8..24].iter().all(|v| *v < 0.0));
    assert!(t[32..=88].iter().all(|v| *v == 0.0));
}

#[test]
fn cymbals_radiate_high_frequencies_and_kick_keeps_its_low_body() {
    use chimera::analysis::fft::Fft;
    let fft = Fft::new(8192);
    let energy = |id| {
        let mut kit = RockKit::new(48000.0);
        kit.set(true, 0.5);
        kit.hit(id, 0.8);
        let mut re: Vec<_> = (0..8192)
            .map(|i| kit.sample() * chimera::math::sin(chimera::math::PI * i as f64 / 8192.0))
            .collect();
        let mut im = vec![0.0; 8192];
        fft.transform(&mut re, &mut im);
        let power: Vec<_> = (1..4096).map(|i| re[i] * re[i] + im[i] * im[i]).collect();
        let total = power.iter().sum::<f64>();
        (
            power[..34].iter().sum::<f64>() / total,
            power[170..].iter().sum::<f64>() / total,
        )
    };
    let kick = energy(0);
    let tom = energy(2);
    let snare = energy(1);
    let hat = energy(5);
    let crash = energy(6);
    assert!(kick.0 > 0.65, "kick low-frequency fraction: {kick:?}");
    assert!(
        hat.1 > 0.20 && crash.1 > 0.20,
        "cymbals too dull: {hat:?}, {crash:?}"
    );
    assert!(
        snare.1 > tom.1 * 2.0,
        "snare lacks wire brightness: snare {snare:?}, tom {tom:?}"
    );
}

#[test]
fn cymbal_decay_spreads_energy_across_many_frequency_bands() {
    use chimera::analysis::fft::Fft;
    let size = 2048;
    let fft = Fft::new(size);
    for id in 5..8 {
        let mut kit = RockKit::new(48000.0);
        kit.set(true, 0.5);
        kit.hit(id, 0.8);
        // Analyze the decay after the stick transient has passed.
        for _ in 0..if id == 5 { 480 } else { 4800 } {
            kit.sample();
        }
        let mut re: Vec<_> = (0..size)
            .map(|i| kit.sample() * chimera::math::sin(chimera::math::PI * i as f64 / size as f64))
            .collect();
        let mut im = vec![0.0; size];
        fft.transform(&mut re, &mut im);
        let power: Vec<_> = (1..size / 2)
            .map(|i| re[i] * re[i] + im[i] * im[i])
            .collect();
        let total = power.iter().sum::<f64>();
        let strongest = power
            .windows(5)
            .map(|p| p.iter().sum::<f64>())
            .fold(0.0, f64::max);
        assert!(total > 0.01, "surface {id} has no audible decay");
        assert!(
            strongest / total < 0.06,
            "surface {id} has a pitched decay: {}",
            strongest / total
        );
    }
}

#[test]
fn felt_beater_compresses_and_releases_while_the_kick_head_rings() {
    use chimera::drums::DRUM_TELE_LEN;
    let mut kit = RockKit::new(48000.0);
    kit.set(true, 0.5);
    kit.hit(0, 0.8);
    let mut t = [0.0; DRUM_TELE_LEN];
    let mut peak_compression = 0.0_f64;
    for _ in 0..240 {
        kit.sample();
        kit.telemetry(&mut t);
        peak_compression = peak_compression.max(t[88]);
    }
    assert!(
        (0.0005..0.005).contains(&peak_compression),
        "{peak_compression}"
    );
    assert_eq!(t[88], 0.0);
    assert!(t[32..36].iter().any(|v| v.abs() > 0.001));
}

#[test]
fn hat_pedal_closes_with_a_chick_and_pressure_chokes_the_tail() {
    use chimera::drums::DRUM_TELE_LEN;
    let mut kit = RockKit::new(48000.0);
    let mut t = [0.0; DRUM_TELE_LEN];
    kit.set(true, 0.5);
    kit.set_hat_pedal(0.0);
    for _ in 0..12000 {
        assert_eq!(kit.sample(), 0.0);
    }
    kit.telemetry(&mut t);
    assert!(t[90] > 0.017);
    assert_eq!(t[91], 0.0);
    kit.hit(5, 0.8);
    let mut open_tail = 0.0;
    for i in 0..12000 {
        let x = kit.sample();
        if i > 7200 {
            open_tail += x * x;
        }
    }

    kit.stop();
    kit.set_hat_pedal(1.0);
    let chick: f64 = (0..12000).map(|_| kit.sample().powi(2)).sum();
    kit.telemetry(&mut t);
    assert!(chick > 0.001);
    assert_eq!(t[90], 0.0);
    assert!(t[91] > 34.0);
    assert!(t[92] >= 0.0);
    assert_eq!(t[21], -1.0, "foot closure must not schedule a stick motion");
    kit.hit(5, 0.8);
    let tight_tail: f64 = (0..12000).map(|_| kit.sample().powi(2)).skip(7200).sum();
    assert!(open_tail > 0.001 && tight_tail < open_tail * 0.05);

    kit.set_hat_pedal(0.0);
    for _ in 0..12000 {
        kit.sample();
    }
    kit.set_hat_pedal(1.0);
    kit.stop();
    for _ in 0..12000 {
        assert_eq!(kit.sample(), 0.0, "stop must cancel a pending chick");
    }
}
