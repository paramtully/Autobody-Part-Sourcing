# ── listingWorker — one Lambda per vendor ────────────────────────────────────
# All functions share the same code zip; they differ only in env vars.
# The filename/source_code_hash lifecycle is ignored so that GitHub Actions
# can call update-function-code without Terraform overwriting it on the next apply.
resource "aws_lambda_function" "listing" {
  for_each = var.vendors

  function_name                  = "listing-worker-${each.key}"
  role                           = aws_iam_role.listing_exec.arn
  handler                        = "handler.handler"
  runtime                        = "nodejs20.x"
  timeout                        = 720 # 12-min code budget (handler.ts line 24)
  reserved_concurrent_executions = 1   # prevent overlapping runs per vendor

  filename = "${path.module}/placeholder.zip"
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  environment {
    variables = merge(local.listing_worker_env, {
      VENDOR_ID          = each.key
      INGEST_INTERVAL_MS = tostring(each.value.interval_ms)
    })
  }

  tags = { vendor = each.key }
}
