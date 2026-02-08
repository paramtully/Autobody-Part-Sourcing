// TODO: remove this since its not purely domain logic
export default interface InterchangeMembership {
    id: string; // UUID

    interchangeId: string;
    partId: string;
  
    confidence?: number;
    source?: string;
    createdAt: Date;
}
  