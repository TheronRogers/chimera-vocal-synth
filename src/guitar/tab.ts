import { pickString, type Frets, type GuitarEvent, type GuitarScore } from "./model.ts";

const GUITAR_LABELS = ["e", "B", "G", "D", "A", "E"];
const BASS_LABELS = ["G", "D", "A", "E"];
export const EXAMPLE_BASS_TAB = `G | - - - - - - - -
D | - - - - 2 - - -
A | - - 2 - - - 2 -
E | 0 - - - - - - -`;
export const EXAMPLE_TAB = `e | - - - 0 3 0 - -
B | - - 1 - - - 1 -
G | - 0 - - - - - 0
D | - - - - - - - -
A | 3 - - - - - - -
E | - - - - 3 - - -`;

/** Each space-separated column is one eighth note, with high E printed first. */
export function planTab(tab: string, bpm: number, bass = false): GuitarScore {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 200) throw new Error("Choose a tempo from 40 to 200 BPM.");
  const lines = tab.trim().split(/\r?\n/);
  const labels = bass ? BASS_LABELS : GUITAR_LABELS;
  if (lines.length !== labels.length) throw new Error(bass ? "Enter four tab rows, from G to E." : "Enter six tab rows, from high e to low E.");
  const rows = lines.map((line, row) => {
    const [label, notes] = line.split("|");
    if (label.trim() !== labels[row] || notes === undefined || line.split("|").length !== 2)
      throw new Error(`Start row ${row+1} with ${labels[row]} |.`);
    return notes.trim().split(/\s+/);
  });
  const count = rows[0].length;
  if (count > 256 || rows.some(row => row.length !== count))
    throw new Error("Use the same number of columns on each row, up to 256.");
  const events: GuitarEvent[] = [];
  const seconds = 30/bpm;
  for (let col = 0; col < count; col++) {
    const frets: Frets = [0,0,0,0,bass ? -1 : 0,bass ? -1 : 0];
    const strings: number[] = [];
    for (let index = 0; index < labels.length; index++) {
      const cell = rows[labels.length-1-index][col];
      if (cell === "-") continue;
      if (!/^(?:[0-9]|1[0-2])$/.test(cell)) throw new Error(`Column ${col+1}: use a fret from 0 to 12, or - for no pluck.`);
      frets[index] = Number(cell);
      strings.push(index);
    }
    for (const index of strings)
      events.push({ time: col*seconds, frets, direction: pickString(index), strength: .76, step: 0 });
  }
  if (!events.length) throw new Error("Add at least one note to the tab.");
  return { events, duration: count*seconds, looping: false, bpm, leadIn: .35 };
}
