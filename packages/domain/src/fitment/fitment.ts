export type FitmentConstraint = 'WITH_RADAR' | 'WITHOUT_RADAR' | 'LED' | 'HALOGEN';

export interface Fitment {
  id: string; // UUID
  make: string;
  model: string;
  yearFrom: number;
  yearTo: number;
  trims?: string[];
  constraints?: FitmentConstraint[];
}
