export default interface InterchangeMembership {
    id: string;
    interchangeId: string;
    partId: string;
  
    confidence?: number;
    source?: string;
    createdAt: Date;
}
  