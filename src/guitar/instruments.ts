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

export interface ElectricBodyProfile {
  name: string;
  tone: string;
  pickup: 1 | 2;
  pickupPosition: number;
  defaultStrings: number;
  depth: number;
  fHoles?: boolean;
  outline: readonly (readonly [number, number])[];
}

// Outline landmarks in metres from the nut, ordered around the body.
export const ELECTRIC_BODIES: readonly ElectricBodyProfile[] = [
  {
    name: "Contoured double cut",
    tone: "Clear and glassy",
    pickup: 1,
    pickupPosition: .80,
    defaultStrings: 1,
    depth: .043,
    outline: [[.46,.032],[.45,.067],[.375,.113],[.41,.145],[.52,.115],[.64,.158],[.747,.139],
      [.805,.067],[.802,-.074],[.738,-.154],[.63,-.151],[.53,-.097],[.457,-.119],[.429,-.099],[.475,-.047],[.46,-.032]],
  },
  {
    name: "Slab single cut",
    tone: "Bright bridge twang",
    pickup: 1,
    pickupPosition: .94,
    defaultStrings: 1,
    depth: .044,
    outline: [[.46,.032],[.43,.085],[.445,.137],[.509,.148],[.574,.124],[.675,.171],[.767,.151],
      [.811,.074],[.811,-.074],[.767,-.151],[.675,-.169],[.558,-.108],[.479,-.134],[.453,-.112],[.49,-.051],[.46,-.032]],
  },
  {
    name: "Carved single cut",
    tone: "Full, punchy humbucker",
    pickup: 2,
    pickupPosition: .86,
    defaultStrings: 1,
    depth: .052,
    outline: [[.46,.032],[.443,.091],[.488,.143],[.551,.148],[.607,.123],[.676,.162],[.765,.143],
      [.823,.073],[.823,-.073],[.765,-.143],[.676,-.162],[.583,-.113],[.505,-.125],[.479,-.097],[.504,-.052],[.46,-.032]],
  },
  {
    name: "Semi-hollow double cut",
    tone: "Warm neck humbucker and flatwounds",
    pickup: 2,
    pickupPosition: .75,
    defaultStrings: 4,
    depth: .062,
    fHoles: true,
    outline: [[.46,.032],[.462,.071],[.403,.114],[.42,.153],[.496,.153],[.562,.132],[.669,.193],
      [.78,.161],[.832,.076],[.832,-.076],[.78,-.161],[.669,-.193],[.562,-.132],[.496,-.153],[.42,-.153],[.403,-.114],[.462,-.071],[.46,-.032]],
  },
];
