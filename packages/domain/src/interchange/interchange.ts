export enum InterchangeSystem {
    HOLLANDER = "HOLLANDER",
    OPTICAT = "OPTICAT",
    CCC = "CCC",
    LKQ = "LKQ",
    VENDOR = "VENDOR", // for vendor-supplied mapping
    UNKNOWN = "UNKNOWN"
}

export interface Interchange {

    // interchange standard or provider
    system: InterchangeSystem;     // ex. Hollander, Opticat, CCC
    code: string;

    createdAt: Date;
}
  