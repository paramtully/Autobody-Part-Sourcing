export enum FitmentConstraint {
    // Sensor packages (most common)
    WITH_RADAR = 'WITH_RADAR',
    WITHOUT_RADAR = 'WITHOUT_RADAR',
    WITH_PARKING_SENSORS = 'WITH_PARKING_SENSORS',
    WITHOUT_PARKING_SENSORS = 'WITHOUT_PARKING_SENSORS',
    WITH_CAMERA = 'WITH_CAMERA',
    WITHOUT_CAMERA = 'WITHOUT_CAMERA',
    
    // Lighting (very common)
    LED = 'LED',
    HALOGEN = 'HALOGEN',
    HID = 'HID',
    ADAPTIVE = 'ADAPTIVE',
    
    // Body style (common)
    SUNROOF = 'SUNROOF',
    NO_SUNROOF = 'NO_SUNROOF',
    
    // Drive type (less common but important)
    AWD = 'AWD',
    FWD = 'FWD',
    RWD = 'RWD',
}

export interface Fitment {
  make: string;
  model: string;
  yearFrom: number;
  yearTo?: number;
  trims?: string[];
  constraints?: FitmentConstraint[];
  engine?: string;
}
