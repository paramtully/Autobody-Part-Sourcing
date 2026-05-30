output "application" {
  description = "Application tag value — use when creating a tag-based myApplications app in AWS Console"
  value       = var.application
}

output "listing_fn_names" {
  description = "List of per-vendor listingWorker Lambda function names"
  value       = [for fn in aws_lambda_function.listing : fn.function_name]
}

output "vercel_api_project_id" {
  description = "Vercel project ID for apps/api — used by deploy-api job"
  value       = vercel_project.api.id
}

output "vercel_client_project_id" {
  description = "Vercel project ID for apps/client — used by deploy-client job"
  value       = vercel_project.client.id
}

output "production_api_url" {
  description = "Production API base URL — https://api.<DOMAIN_NAME> when domain is configured"
  value       = local.api_public_url
}

output "production_client_url" {
  description = "Production client URL — https://<DOMAIN_NAME> when domain is configured"
  value       = local.site_public_url
}
