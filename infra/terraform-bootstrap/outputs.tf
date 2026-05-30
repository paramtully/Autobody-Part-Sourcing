output "gh_deploy_role_arn" {
  description = "ARN of the GitHub Actions OIDC deploy role — set as AWS_DEPLOY_ROLE_ARN in GH production environment"
  value       = aws_iam_role.gh_deploy.arn
}
