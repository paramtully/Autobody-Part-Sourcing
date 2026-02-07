
export enum PartCondition {
    NEW_OEM = "NEW_OEM",                     // Brand new, original manufacturer part
    NEW_AFTERMARKET = "NEW_AFTERMARKET",     // Brand new, non-OEM manufacturer
    RECYCLED = "RECYCLED",                   // Used OEM part (e.g., salvaged / LKQ)
    REMANUFACTURED = "REMANUFACTURED",       // Rebuilt to OEM spec, often with warranty
    RECONDITIONED = "RECONDITIONED",         // Cleaned/repaired but not fully remanufactured
    UNKNOWN = "UNKNOWN"                      // Vendor did not specify condition
  }
  