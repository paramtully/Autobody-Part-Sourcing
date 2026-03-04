// Email ingestion: parse inbound vendor emails, update order status, forward to customer.
// TODO: migrate from packages/infrastructure/emailIngestion/
export * from './parser';
export * from './forwarder';
