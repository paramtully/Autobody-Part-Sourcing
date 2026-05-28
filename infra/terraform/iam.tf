data "aws_caller_identity" "current" {}

# ── Shared Secrets Manager data source ───────────────────────────────────────
data "aws_secretsmanager_secret_version" "supabase" {
  secret_id = "prod/supabase/database_url"
}

# ── listingWorker execution role ──────────────────────────────────────────────
resource "aws_iam_role" "listing_exec" {
  name = "listing-worker-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "listing_exec" {
  name = "listing-worker-exec-policy"
  role = aws_iam_role.listing_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/listing-worker-*:*"
      },
      {
        Sid      = "SecretsManager"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:prod/supabase/*"
      },
    ]
  })
}

# ── Vercel API SQS doorbell publisher ────────────────────────────────────────
# Minimal IAM user for Vercel (cannot use OIDC from Vercel serverless).
# Only permission: SendMessage on the outbox queue.
resource "aws_iam_user" "api_outbox_publisher" {
  name = "vercel-api-outbox-publisher"
}

resource "aws_iam_user_policy" "api_outbox_publisher" {
  name = "vercel-api-outbox-publisher-policy"
  user = aws_iam_user.api_outbox_publisher.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = aws_sqs_queue.outbox.arn
    }]
  })
}
