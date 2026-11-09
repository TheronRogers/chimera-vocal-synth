import { call } from "../wasm/chimera.ts";

export interface GuitarBodyProfile {
  name: string;
  lengthScale: number;
  widthScale: number;
  depthScale: number;
  arch: number;
  defaultStrings: number;
  frequencyScale: number;
}

interface InstrumentCatalog {
  bodies: GuitarBodyProfile[];
  strings: { name: string }[];
}

let catalog: InstrumentCatalog | undefined;
export function guitarInstruments(): InstrumentCatalog {
  return catalog ??= call<InstrumentCatalog>("guitarInstruments");
}
