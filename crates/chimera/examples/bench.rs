//! Real-time factor of the voices (single core): `cargo run --release -p chimera --example bench`.
use chimera::anatomy::human::BODY_MALE;
use chimera::control::score::Gesture;
use chimera::engine::Engine;
use chimera::guitar::GuitarEvent;
use chimera::voice::human_voice::{HumanVoice, SourcePatch};
use std::time::Instant;

fn main() {
    let root = concat!(env!("CARGO_MANIFEST_DIR"));
    let v: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(format!("{root}/tests/golden/voice.json")).unwrap(),
    )
    .unwrap();
    let s = v
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == "speech-male")
        .unwrap();
    let gs: Vec<Gesture> = serde_json::from_value(s["ops"][0]["gestures"].clone()).unwrap();
    for os in [2usize, 1] {
        let fs = 48000.0;
        let mut voice = HumanVoice::new(fs, BODY_MALE, os);
        voice.set_source(&SourcePatch::f0(110.0));
        let mut g2 = gs.clone();
        for g in g2.iter_mut() {
            g.t0 += 0.03;
            g.t1 += 0.03;
        }
        voice.schedule(&g2);
        voice.set_gate(1.0);
        let secs = 4.0;
        let n = (fs * secs) as usize;
        let mut out = vec![0.0f32; 128];
        let t0 = Instant::now();
        for _ in 0..n / 128 {
            voice.render(&mut out);
        }
        let dt = t0.elapsed().as_secs_f64();
        println!(
            "human male os={os}: {:.1}% of one core in real time ({:.2} ms per 128-sample block)",
            100.0 * dt / secs,
            1000.0 * dt / (n / 128) as f64
        );
    }
    for (singer, drummer) in [(false,false), (true,false), (true,true)] {
        let fs = 48000.0;
        let mut engine = Engine::new(fs);
        engine.set_guitar(true);
        engine.set_guitar_levels(0.7, if singer { 0.8 } else { 0.0 });
        if singer {
            engine.schedule(&gs, 0.03, false);
            engine.set_gate(1.0);
        }
        engine.guitar.load_score(
            &[
                GuitarEvent {
                    time: 0.0,
                    frets: [0, 2, 2, 1, 0, 0],
                    direction: 1,
                    strength: 0.9,
                    step: 0,
                },
                GuitarEvent {
                    time: 0.25,
                    frets: [3, 2, 0, 0, 0, 3],
                    direction: -1,
                    strength: 0.7,
                    step: 1,
                },
            ],
            0.03,
            0.5,
            true,
            120.0,
        );
        if drummer {
            engine.drums.set(true,0.5);
            engine.drums.schedule(0.0,0.03,0.5,true,120.0);
        }
        let secs = 4.0;
        let blocks = (fs * secs) as usize / 128;
        let mut out = [0.0; 128];
        let t0 = Instant::now();
        for _ in 0..blocks {
            engine.render(&mut out);
        }
        let dt = t0.elapsed().as_secs_f64();
        println!(
            "six-string guitar{}: {:.1}% of one core in real time ({:.2} ms per 128-sample block)",
            if drummer {
                " + singer + physical drums"
            } else if singer {
                " + singer"
            } else {
                " (singer silent)"
            },
            100.0 * dt / secs,
            1000.0 * dt / blocks as f64
        );
    }
}
