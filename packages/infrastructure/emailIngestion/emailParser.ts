/**
 * Email parser for inbound vendor emails (EMAIL_MANUAL flow).
 * Extracts orderId from recipient address and status keywords from subject/body.
 */

// ────────────────────────────────────────────────────────────────
// OrderId extraction
// ────────────────────────────────────────────────────────────────

const ORDER_ADDRESS_REGEX = /^orders\+([0-9a-f-]{36})@/i;

/**
 * Extracts the orderId from a `orders+{uuid}@mail.platform.com` address.
 * @returns orderId string, or null if the address doesn't match the pattern
 */
export function extractOrderIdFromAddress(toAddress: string): string | null {
    const match = toAddress.match(ORDER_ADDRESS_REGEX);
    return match ? match[1] : null;
}

// ────────────────────────────────────────────────────────────────
// Status keyword classification
// ────────────────────────────────────────────────────────────────

export type ParsedEmailStatus = 'CONFIRMED' | 'REJECTED' | 'INFO';

const CONFIRMED_KEYWORDS = [
    'confirmed',
    'order confirmed',
    'we confirm your order',
    'confirmation',
    'has been confirmed',
    'order accepted',
    'accepted',
    'shipped',
    'shipping',
    'dispatched',
];

const REJECTED_KEYWORDS = [
    'rejected',
    'unable to fulfill',
    'cancelled',
    'canceled',
    'out of stock',
    'cannot process',
    'declined',
    'not available',
    'order has been cancelled',
];

/**
 * Classifies email content as CONFIRMED, REJECTED, or INFO.
 * Scans subject first, then body. Case-insensitive.
 * @returns 'CONFIRMED' | 'REJECTED' | 'INFO'
 */
export function classifyEmailStatus(subject: string, body: string): ParsedEmailStatus {
    const text = `${subject} ${body}`.toLowerCase();

    for (const kw of REJECTED_KEYWORDS) {
        if (text.includes(kw)) return 'REJECTED';
    }

    for (const kw of CONFIRMED_KEYWORDS) {
        if (text.includes(kw)) return 'CONFIRMED';
    }

    return 'INFO';
}

// ────────────────────────────────────────────────────────────────
// Tracking number extraction
// ────────────────────────────────────────────────────────────────

const TRACKING_PATTERNS = [
    // UPS: 1Z followed by 16 alphanumeric chars
    /\b(1Z[0-9A-Z]{16})\b/i,
    // USPS: 20-22 digit number
    /\b(\d{20,22})\b/,
    // FedEx: 12 or 15 digit number
    /\b(\d{12})\b/,
    /\b(\d{15})\b/,
];

/**
 * Attempts to extract a tracking number from email text.
 * @returns tracking number string, or null if not found
 */
export function extractTrackingNumber(text: string): string | null {
    for (const pattern of TRACKING_PATTERNS) {
        const match = text.match(pattern);
        if (match) return match[1];
    }
    return null;
}

/**
 * Full parse result from an inbound email.
 */
export interface ParsedEmail {
    orderId: string | null;
    status: ParsedEmailStatus;
    trackingNumber: string | null;
}

/**
 * Parses an inbound email into structured data.
 */
export function parseInboundEmail(input: {
    toAddress: string;
    subject: string;
    body: string;
}): ParsedEmail {
    return {
        orderId: extractOrderIdFromAddress(input.toAddress),
        status: classifyEmailStatus(input.subject, input.body),
        trackingNumber: extractTrackingNumber(`${input.subject} ${input.body}`),
    };
}
