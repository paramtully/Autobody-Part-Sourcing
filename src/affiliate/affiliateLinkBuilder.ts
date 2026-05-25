export interface AffiliateLinkBuilder {
    readonly vendorId: string;
    readonly enabled: boolean;
    /** Return decorated URL, or null when this builder cannot/should not wrap. */
    wrap(canonicalUrl: string): string | null;
}
