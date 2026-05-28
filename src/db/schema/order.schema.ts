import { z } from 'zod';

// ── Schemas ───────────────────────────────────────────────────────────────────
// .strict() rejects any unknown keys — prevents clients from injecting pricing
// fields (itemPriceMinor, serviceFeeMinor, etc.).

export const shippingAddressSchema = z
  .object({
    line1: z.string().min(1),
    city: z.string().min(1),
    stateOrProvince: z.string().min(1),
    postalCode: z.string().min(1),
    country: z.string().length(2),
  })
  .strict();

export const quoteBodySchema = z
  .object({
    listingId: z.uuid(),
    shippingAddress: shippingAddressSchema,
  })
  .strict();

export const confirmBodySchema = z
  .object({
    quoteId: z.uuid(),
    contactEmail: z.email(),
    contactPhone: z.string().optional(),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export type QuoteBody = z.infer<typeof quoteBodySchema>;
export type ConfirmBody = z.infer<typeof confirmBodySchema>;
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;