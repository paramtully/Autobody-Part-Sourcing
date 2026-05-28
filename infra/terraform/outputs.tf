output "application" {
  description = "Application tag value — use when creating a tag-based myApplications app in AWS Console"
  value       = var.application
}

output "listing_fn_names" {
  description = "List of per-vendor listingWorker Lambda function names"
  value       = [for fn in aws_lambda_function.listing : fn.function_name]
}

output "outbox_queue_url" {
  description = "SQS outbox queue URL — set as OUTBOX_QUEUE_URL on the Vercel API project"
  value       = aws_sqs_queue.outbox.url
}

output "api_publisher_access_key_id" {
  description = "IAM access key ID for vercel-api-outbox-publisher (create the secret key manually per BOOTSTRAP.md)"
  value       = aws_iam_user.api_outbox_publisher.name
}

output "gh_deploy_role_arn" {
  description = "ARN of the GitHub Actions OIDC deploy role — set as AWS_DEPLOY_ROLE_ARN in GH production environment"
  value       = aws_iam_role.gh_deploy.arn
}
