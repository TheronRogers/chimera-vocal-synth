import { Path, Vector2 } from "three";

export interface PlateMesh {
  nodes: number[][];
  triangles: number[];
  modes: { hz: number; shape: number[] }[];
}

/** Mirrored S-shaped openings with enlarged eyes at the ends. */
export function fHole(side: number): Path {
  const path = new Path();
  const x = (v: number) => .616 + v;
  const y = (v: number) => side * (.088 + v);
  path.moveTo(x(-.065), y(.019));
  path.bezierCurveTo(x(-.084), y(.014), x(-.073), y(-.011), x(-.052), y(-.005));
  path.bezierCurveTo(x(-.020), y(.004), x(.018), y(-.025), x(.046), y(-.018));
  path.bezierCurveTo(x(.041), y(-.039), x(.078), y(-.039), x(.073), y(-.017));
  path.bezierCurveTo(x(.065), y(.005), x(.022), y(-.012), x(.003), y(-.004));
  path.bezierCurveTo(x(-.027), y(.008), x(-.043), y(.010), x(-.056), y(.007));
  path.quadraticCurveTo(x(-.051), y(.025), x(-.065), y(.019));
  path.closePath();
  return path;
}

function inside(x: number, y: number, polygon: Vector2[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Restore the flat-top mesh's missing round port samples, then cut the two f-holes.
 * Interpolate display shapes inside the old port from its surrounding samples.
 */
export function archtopPlate(base: PlateMesh, outline: number[][], port: number[], holes: Path[]): PlateMesh {
  const nodes = base.nodes.slice();
  const modes = base.modes.map(mode => ({ ...mode, shape: mode.shape.slice() }));
  const start = outline[0][0];
  const dx = (Math.max(...outline.map(([x]) => x)) - start) / 44;
  const dy = .01;
  const cell = (i: number, j: number) => i * 41 + j;
  const grid = new Map(base.nodes.map(([x, y], i) => [cell(Math.round((x - start) / dx), Math.round((y + .2) / dy)), i]));
  const rim = base.nodes.flatMap(([x, y], i) => Math.hypot(x - port[0], y) < port[2] + .021 ? [i] : []);
  const polygons = holes.map(hole => hole.getPoints(8));
  for (let i = 1; i < 44; i++) for (let j = 1; j < 40; j++) {
    const x = start + i * dx, y = -.2 + j * dy;
    const key = cell(i, j);
    if (polygons.some(polygon => inside(x, y, polygon))) {
      grid.delete(key);
    } else if (!grid.has(key) && Math.hypot(x - port[0], y) < port[2]) {
      const weights = rim.map(k => 1 / ((x - nodes[k][0]) ** 2 + (y - nodes[k][1]) ** 2));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      grid.set(key, nodes.length);
      nodes.push([x, y]);
      for (const mode of modes) {
        mode.shape.push(rim.reduce((sum, k, n) => sum + mode.shape[k] * weights[n], 0) / total);
      }
    }
  }
  const triangles: number[] = [];
  for (let i = 1; i < 44; i++) for (let j = 1; j < 40; j++) {
    const a = grid.get(cell(i, j)), b = grid.get(cell(i + 1, j));
    const c = grid.get(cell(i, j + 1)), d = grid.get(cell(i + 1, j + 1));
    if (a !== undefined && b !== undefined && c !== undefined) triangles.push(a, b, c);
    if (b !== undefined && c !== undefined && d !== undefined) triangles.push(b, d, c);
  }
  return {nodes, triangles, modes};
}
