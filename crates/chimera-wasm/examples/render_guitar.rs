//! Native reference for tests/guitar.test.ts: six strings, score, body, and human mix.
use chimera_wasm::*;
use std::io::{self, Write};
fn main() {
    let mut stdout = io::stdout().lock();
    for fs in [44100.0, 48000.0] {
        let h = engine_new(fs);
        unsafe {
            engine_guitar(h, 0, 1.0, 0.0, 0.0);
            if fs == 48000.0 {
                engine_guitar(h, 11, 5.0, 4.0, 0.0);
            }
            engine_set_gate(h, 0.7);
            let records = std::slice::from_raw_parts_mut(engine_guitar_records(h), 3 * GUITAR_EVENT_BYTES);
            for (i, values) in [
                [0.0, 0.0,2.0,2.0,0.0,0.0,0.0, 1.0,0.8,0.0],
                [0.24,-1.0,3.0,2.0,0.0,1.0,0.0,-1.0,0.7,1.0],
                [0.5, 1.0,3.0,3.0,2.0,1.0,1.0, 1.0,0.8,2.0],
            ].iter().enumerate() {
                for (j, value) in values.iter().enumerate() { records[i*80+j*8..i*80+j*8+8].copy_from_slice(&f64::to_le_bytes(*value)); }
            }
            engine_guitar_schedule(h, 3, 0.05, 0.6, 1, 100.0);
            for block in 0..280 {
                match block {
                    80 => engine_guitar(h,4,-1.0,0.8,0.0),
                    110 => engine_guitar(h,2,2.0,1.0,0.0),
                    125 => engine_guitar(h,3,2.0,0.8,0.0),
                    160 => engine_guitar(h,2,2.0,0.0,0.0),
                    220 => engine_set_gate(h,0.0),
                    230 => engine_guitar(h,5,0.0,0.0,0.0),
                    _ => {}
                }
                let p = engine_render(h,128);
                for x in std::slice::from_raw_parts(p,128) { stdout.write_all(&x.to_le_bytes()).unwrap(); }
                engine_guitar_telemetry(h);
            }
            engine_free(h);
        }
    }
}
