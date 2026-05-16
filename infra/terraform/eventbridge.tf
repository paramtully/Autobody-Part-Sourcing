# ── Per-vendor listingWorker schedules ───────────────────────────────────────
resource "aws_cloudwatch_event_rule" "listing" {
  for_each            = var.vendors
  name                = "listing-worker-${each.key}"
  schedule_expression = each.value.schedule_expression
}

resource "aws_cloudwatch_event_target" "listing" {
  for_each = var.vendors
  rule     = aws_cloudwatch_event_rule.listing[each.key].name
  arn      = aws_lambda_function.listing[each.key].arn
}

resource "aws_lambda_permission" "listing_from_eventbridge" {
  for_each      = var.vendors
  statement_id  = "AllowEventBridgeInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.listing[each.key].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.listing[each.key].arn
}

# ── paymentWorker safety-net schedule ─────────────────────────────────────────
# Drains any outbox rows that were missed if the SQS doorbell was dropped
# (e.g. API crash between DB commit and SendMessage, or a queue outage).
resource "aws_cloudwatch_event_rule" "payment_safety_net" {
  name                = "payment-worker-safety-net"
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "payment_safety_net" {
  rule = aws_cloudwatch_event_rule.payment_safety_net.name
  arn  = aws_lambda_function.payment.arn
}

resource "aws_lambda_permission" "payment_safety_net" {
  statement_id  = "AllowEventBridgeInvokePaymentSafetyNet"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.payment.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.payment_safety_net.arn
}
