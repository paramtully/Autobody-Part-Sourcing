export const ORDER_TOPICS = {
  CREATED:                  'order.created',
  PENDING_PAYMENT:          'order.pending_payment',
  PAYMENT_AUTHORIZED:       'order.payment_authorized',
  VENDOR_STATUS_CHANGED:    'order.vendor_status_changed',
  PAYMENT_CANCEL_REQUIRED:  'order.payment_cancel_required',
} as const;

export type OrderTopic = (typeof ORDER_TOPICS)[keyof typeof ORDER_TOPICS];
