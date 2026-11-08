//! Native reference for tests/guitar.test.ts, through the browser's numeric ABI.
use chimera_wasm::*;
use std::io::{self, Write};
fn main() {
    let mut stdout = io::stdout().lock();
    for fs in [44100.0, 48000.0] {
        let h = engine_new(fs);
        unsafe {
            engine_guitar(h, 0, 1.0, 0.0, 0.0);
            for block in 0..160 {
                match block {
                    0 | 80 => engine_guitar(h, 4, 0.0, 0.0, 0.0),
                    45 => engine_guitar(h, 1, 1.0, 0.0, 0.0),
                    110 => engine_guitar(h, 2, 0.6, -0.002, 1.0),
                    125 => engine_guitar(h, 3, 0.0, 0.0, 0.0),
                    150 => engine_guitar(h, 5, 0.0, 0.0, 0.0),
                    _ => {}
                }
                let p = engine_render(h, 128);
                for x in std::slice::from_raw_parts(p, 128) {
                    stdout.write_all(&x.to_le_bytes()).unwrap();
                }
                engine_guitar_telemetry(h);
            }
            engine_free(h);
        }
    }
}
