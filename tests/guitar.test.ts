import { expect, test } from "bun:test";
import { wasmModule } from "./harness.ts";

test("guitar numeric ABI matches native audio with contacts, telemetry, and mute", () => {
  const native = Bun.spawnSync(["cargo", "run", "-q", "--release", "-p", "chimera-wasm", "--example", "render_guitar"]);
  expect(native.exitCode).toBe(0);
  type X = { memory: WebAssembly.Memory } & Record<string, (...a: number[]) => number>;
  const x = new WebAssembly.Instance(wasmModule, {}).exports as X;
  const audio = new Float32Array(2 * 160 * 128);
  let offset = 0;
  for (const fs of [44100, 48000]) {
    const h = x.engine_new(fs);
    x.engine_guitar(h, 0, 1, 0, 0);
    for (let block = 0; block < 160; block++) {
      if (block === 0 || block === 80) x.engine_guitar(h, 4, 0, 0, 0);
      if (block === 45) x.engine_guitar(h, 1, 1, 0, 0);
      if (block === 110) x.engine_guitar(h, 2, 0.6, -0.002, 1);
      if (block === 125) x.engine_guitar(h, 3, 0, 0, 0);
      if (block === 150) x.engine_guitar(h, 5, 0, 0, 0);
      const p = x.engine_render(h, 128);
      audio.set(new Float32Array(x.memory.buffer, p, 128), offset); offset += 128;
      const t = new Float64Array(x.memory.buffer, x.engine_guitar_telemetry(h), 264);
      expect(t.every(Number.isFinite)).toBe(true);
      expect(t[0]).toBe((block + 1) * 128 / fs);
      if (block > 150) expect(t[1]).toBe(0);
    }
    x.engine_free(h);
  }
  expect(Buffer.from(audio.buffer).equals(native.stdout)).toBe(true);
  expect(audio.some(s => Math.abs(s) > 0.01)).toBe(true);
}, 120000);
