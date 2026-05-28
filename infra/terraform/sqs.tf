resource "aws_sqs_queue" "outbox_dlq" {
  name                      = "outbox-dlq"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "outbox" {
  name                       = "outbox"
  message_retention_seconds  = 86400 # 1 day; events are drained quickly
  visibility_timeout_seconds = 90

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.outbox_dlq.arn
    maxReceiveCount     = 5
  })
}
