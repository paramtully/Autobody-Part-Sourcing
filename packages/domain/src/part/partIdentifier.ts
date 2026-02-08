export type PartIdentifierType = 'OEM' | 'AFTERMARKET';

export interface PartIdentifier {
  id: string;
  partId: string;

  // together make unique key
  type: PartIdentifierType;
  value: string;
  manufacturer: string;

  certification?: 'CAPA' | 'NSF';
  createdAt: Date;
}