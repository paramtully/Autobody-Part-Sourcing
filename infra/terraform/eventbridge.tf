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
