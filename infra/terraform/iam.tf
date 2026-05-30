data "aws_caller_identity" "current" {}

# ── listingWorker execution role ──────────────────────────────────────────────
resource "aws_iam_role" "listing_exec" {
  provider = aws.iam
  name     = "listing-worker-exec"

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
  provider = aws.iam
  name     = "listing-worker-exec-policy"
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
    ]
  })
}
