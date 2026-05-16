resource "aws_sqs_queue" "outbox_dlq" {
  name                      = "outbox-dlq"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "outbox" {
  name                      = "outbox"
  message_retention_seconds = 86400 # 1 day; events are drained quickly
  visibility_timeout_seconds = 90   # > paymentWorker timeout (60s)

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.outbox_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_lambda_event_source_mapping" "payment_from_sqs" {
  event_source_arn = aws_sqs_queue.outbox.arn
  function_name    = aws_lambda_function.payment.arn
  batch_size       = 10
  # Prevents SQS from invoking the lambda while it's still processing a batch
  function_response_types = ["ReportBatchItemFailures"]
}
