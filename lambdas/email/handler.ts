/**
 * AWS Lambda handler for inbound vendor email processing.
 *
 * Receives a webhook POST from an email provider (e.g., Postmark, SendGrid Inbound Parse).
 * Parses the email, updates order status, and forwards to the customer.
 *
 * Always returns HTTP 200 to prevent provider retry storms.
 *
 * TODO: wire up src/email/parser and src/email/forwarder once migrated.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    console.log('Email Lambda triggered', { subject: event.headers?.['Subject'] });
    // TODO: parse body → parseInboundEmail() → logEmail() → updateOrderStatus() → forwardToCustomer()
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('Email Lambda error', err);
    // Still return 200 to prevent provider retries
    return { statusCode: 200, body: 'ok' };
  }
}
