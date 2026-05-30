variable "application" {
  type        = string
  description = "Application name for AWS console grouping (myApplications) and cost allocation"
  default     = "autobody-part-sourcing"
}

variable "environment" {
  type        = string
  description = "Deployment environment (prod, staging, etc.)"
  default     = "prod"
}

variable "aws_region" {
  type    = string
  default = "us-west-2"
}

variable "github_owner" {
  type        = string
  description = "GitHub org or username that owns the repo (e.g. my-org)"
}

variable "github_repo" {
  type        = string
  description = "GitHub repo name without the owner prefix (e.g. Autobody-Part-Sourcing)"
}

variable "github_actions_environment" {
  type        = string
  description = "GitHub Actions environment name used on deploy jobs (OIDC sub claim)"
  default     = "production"
}

variable "vendors" {
  type = map(object({
    interval_ms         = number
    schedule_expression = string
  }))
  description = "Map of vendor_id -> { interval_ms (cooldown), schedule_expression (EventBridge rate) }"
  default = {
    # 24-hour ingestion cadence; EventBridge wakes every 15 min to check cooldown
    ebay-us = { interval_ms = 1000 * 60 * 60 * 24, schedule_expression = "rate(15 minutes)" }
    ebay-ca = { interval_ms = 1000 * 60 * 60 * 24, schedule_expression = "rate(15 minutes)" }
  }
}

# ── Vercel (GitHub Actions passes these as TF_VAR_* from production secrets) ──

variable "vercel_api_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Vercel API token (same value as VERCEL_TOKEN in GitHub)"
}

variable "vercel_team_id" {
  type        = string
  default     = ""
  description = "Vercel team ID (GitHub variable VERCEL_ORG_ID)"
}

variable "domain_name" {
  type        = string
  default     = ""
  description = "Registered apex domain, e.g. getboneyard.com — enables custom domains and NEXT_PUBLIC_API_BASE_URL"
}

variable "database_url" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Supabase pooler URL — used by Vercel API runtime and listing Lambdas"
}

variable "ebay_epn_campid" {
  type        = string
  default     = ""
  description = "Optional eBay Partner Network campaign ID for affiliate links on the API"
}

# ── listingWorker Lambda credentials (GitHub Actions passes these as TF_VAR_*) ──

variable "ebay_api_key" {
  type        = string
  sensitive   = true
  default     = ""
  description = "eBay developer app client ID (EBAY_API_KEY)"
}

variable "ebay_api_secret" {
  type        = string
  sensitive   = true
  default     = ""
  description = "eBay developer app client secret (EBAY_API_SECRET)"
}

variable "ebay_user_refresh_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = "eBay user refresh token for Trading API (EBAY_USER_REFRESH_TOKEN)"
}

variable "ebay_ru_name" {
  type        = string
  default     = ""
  description = "Optional eBay RuName for user OAuth (EBAY_RU_NAME)"
}
