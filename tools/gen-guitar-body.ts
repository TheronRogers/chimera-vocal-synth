/** Offline Rayleigh–Ritz reduction of an orthotropic X-braced spruce plate.
 * Run: bun tools/gen-guitar-body.ts (after bun run wasm). No runtime eigensolver.
 */
import { call, initChimera } from "../src/wasm/chimera.ts";
await initChimera(await Bun.file("src/wasm/chimera.wasm").arrayBuffer());
const g = call<{ outline: number[][]; soundhole: number[] }>("guitarGeometry");
const start = Math.min(...g.outline.map((p) => p[0])),
  end = Math.max(...g.outline.map((p) => p[0])),
  span = end - start;
const size = 16,
  nx = 44,
  ny = 40,
  dx = span / nx,
  dy = .4 / ny,
  area = dx * dy,
  rho = 430,
  thickness = .0028;
const M = Array.from({ length: size }, () => Array(size).fill(0)),
  K = M.map((r) => r.slice());
const width = (x: number) => {
  const half = g.outline.slice(0, 101);
  let i = 0;
  while (i < 99 && half[i + 1][0] < x) i++;
  const a = half[i], b = half[i + 1];
  return a[1] +
    (b[1] - a[1]) * Math.max(0, Math.min(1, (x - a[0]) / (b[0] - a[0])));
};
function basis(k: number, x: number, y: number) {
  const w = width(x);
  if (x <= start || x >= end || w <= 0 || Math.abs(y) >= w) return 0;
  const u = (x - start) / span, v = y / w;
  return Math.sin(Math.PI * u) ** 2 * (1 - v * v) ** 2 *
    Math.cos(Math.floor(k / 4) * Math.PI * u) *
    Math.cos((k % 4) * Math.PI * (v + 1) / 2);
}
const nodes: number[][] = [], values: number[][] = [];
for (let ix = 1; ix < nx; ix++) {
  for (let iy = 1; iy < ny; iy++) {
    const x = start + ix * dx, y = -.2 + iy * dy;
    if (
      Math.abs(y) >= width(x) ||
      Math.hypot(x - g.soundhole[0], y) < g.soundhole[2]
    ) continue;
    nodes.push([x, y]);
    const b = Array.from({ length: size }, (_, k) => basis(k, x, y));
    values.push(b);
    const xx = b.map((v, k) =>
      (basis(k, x + dx, y) - 2 * v + basis(k, x - dx, y)) / (dx * dx)
    );
    const yy = b.map((v, k) =>
      (basis(k, x, y + dy) - 2 * v + basis(k, x, y - dy)) / (dy * dy)
    );
    const xy = b.map((_, k) =>
      (basis(k, x + dx, y + dy) - basis(k, x + dx, y - dy) -
        basis(k, x - dx, y + dy) + basis(k, x - dx, y - dy)) / (4 * dx * dy)
    );
    // Generic spruce E_long=10 GPa, E_cross=.8 GPa, G=.6 GPa. X braces
    // contribute positive local bending stiffness; no measured audio/IR is used.
    const brace =
      Math.min(Math.abs(y - (x - .57) * .8), Math.abs(y + (x - .57) * .8)) <
          .006
        ? 5
        : 1;
    const d = thickness ** 3 / 12 * brace;
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        M[i][j] += rho * thickness * area * b[i] * b[j];
        K[i][j] += area * d *
          (1e10 * xx[i] * xx[j] + .8e9 * yy[i] * yy[j] +
            .25e9 * (xx[i] * yy[j] + yy[i] * xx[j]) + 2.4e9 * xy[i] * xy[j]);
      }
    }
  }
}
const L = M.map((r) => r.map(() => 0));
for (let i = 0; i < size; i++) {
  for (let j = 0; j <= i; j++) {
    let v = M[i][j];
    for (let k = 0; k < j; k++) v -= L[i][k] * L[j][k];
    L[i][j] = i === j ? Math.sqrt(v) : v / L[j][j];
  }
}
const inverse = L.map((r) => r.map(() => 0));
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    let v = i === j ? 1 : 0;
    for (let k = 0; k < i; k++) v -= L[i][k] * inverse[k][j];
    inverse[i][j] = v / L[i][i];
  }
}
const A = K.map((_, i) =>
  K.map((_, j) => {
    let v = 0;
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < size; b++) {
        v += inverse[i][a] * K[a][b] * inverse[j][b];
      }
    }
    return v;
  })
);
const V: number[][] = K.map((_, i) => K.map((_, j) => i === j ? 1 : 0));
for (let sweep = 0; sweep < 100; sweep++) {
  let max = 0;
  for (let p = 0; p < size; p++) {
    for (let q = p + 1; q < size; q++) {
      max = Math.max(max, Math.abs(A[p][q]));
      if (Math.abs(A[p][q]) < 1e-8) continue;
      const theta = .5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]),
        c = Math.cos(theta),
        s = Math.sin(theta),
        app = A[p][p],
        aqq = A[q][q],
        apq = A[p][q];
      for (let k = 0; k < size; k++) {
        if (k !== p && k !== q) {
          const a = A[k][p], b = A[k][q];
          A[k][p] = A[p][k] = c * a - s * b;
          A[k][q] = A[q][k] = s * a + c * b;
        }
      }
      A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
      A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
      A[p][q] = A[q][p] = 0;
      for (let k = 0; k < size; k++) {
        const a = V[k][p], b = V[k][q];
        V[k][p] = c * a - s * b;
        V[k][q] = s * a + c * b;
      }
    }
  }
  if (max < 1e-7) break;
}
const modes = Array.from({ length: size }, (_, j) => {
  const coeff = Array.from({ length: size }, (_, i) => {
    let v = 0;
    for (let k = 0; k < size; k++) v += inverse[k][i] * V[k][j];
    return v;
  });
  const shape = values.map((b) => b.reduce((s, v, i) => s + v * coeff[i], 0));
  return {
    hz: Math.sqrt(A[j][j]) / (2 * Math.PI),
    bridge: coeff.reduce((s, v, i) => s + v * basis(i, .648, 0), 0),
    volume: shape.reduce((s, v) => s + v * area, 0),
    shape,
  };
}).sort((a, b) => a.hz - b.hz);
const lookup = new Map(
  nodes.map((
    p,
    i,
  ) => [
    `${Math.round((p[0] - start) / dx)},${Math.round((p[1] + .2) / dy)}`,
    i,
  ]),
);
const triangles: number[] = [];
for (let x = 1; x < nx; x++) {
  for (let y = 1; y < ny; y++) {
    const a = lookup.get(`${x},${y}`),
      b = lookup.get(`${x + 1},${y}`),
      c = lookup.get(`${x},${y + 1}`),
      d = lookup.get(`${x + 1},${y + 1}`);
    if (
      a !== undefined && b !== undefined && c !== undefined && d !== undefined
    ) triangles.push(a, b, c, b, d, c);
  }
}
await Bun.write(
  "crates/chimera/src/guitar/body.generated.json",
  JSON.stringify({ nodes, modes, triangles }),
);
console.log(modes.map((m) => m.hz.toFixed(1)).join(", "));
