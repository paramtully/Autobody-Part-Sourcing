/**
 * AWS Lambda handler for vendor listing ingestion.
 *
 * Triggered by an EventBridge scheduled rule (e.g., every 6 hours).
 * Processes one page per invocation and stores a cursor in ingestion_runs
 * so the next trigger resumes from where it left off.
 *
 * TODO: wire up vendor clients from src/vendors/ once migrated.
 */

import type { ScheduledEvent, Context } from 'aws-lambda';

export async function handler(event: ScheduledEvent, context: Context): Promise<void> {
  console.log('Ingestion Lambda triggered', { event, requestId: context.awsRequestId });
  // TODO: iterate registered vendors → call processIngestionChunk() from src/vendors/pipeline
}
