locals {
  # Applied to all taggable resources via provider default_tags (myApplications, Tag Editor, cost allocation).
  default_tags = {
    Application = var.application
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = "${var.github_owner}/${var.github_repo}"
  }

  # GitHub secrets → Terraform → Lambda env vars. No Secrets Manager hop.
  # EBAY_API_URL is intentionally omitted: production workers use the hardcoded
  # default in vendorClient.ebay.ts ("https://api.ebay.com"). Set it in .env
  # locally when you need the sandbox endpoint.
  listing_worker_env = {
    DATABASE_URL            = var.database_url
    EBAY_API_KEY            = var.ebay_api_key
    EBAY_API_SECRET         = var.ebay_api_secret
    EBAY_USER_REFRESH_TOKEN = var.ebay_user_refresh_token
    EBAY_RU_NAME            = var.ebay_ru_name
  }
}
