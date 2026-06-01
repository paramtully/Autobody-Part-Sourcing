# Vercel projects, domains, and production env vars.
# GitHub Actions passes secrets as TF_VAR_*; code deploys still use `vercel deploy` in CI.
# One-time import if you already ran `vercel link` in apps/api:
#   terraform import vercel_project.api prj_XXXX

locals {
  api_hostname    = var.domain_name != "" ? "api.${var.domain_name}" : ""
  api_public_url  = local.api_hostname != "" ? "https://${local.api_hostname}" : ""
  site_public_url = var.domain_name != "" ? "https://${var.domain_name}" : ""
}

resource "vercel_project" "api" {
  name            = "${var.application}-api"
  root_directory  = "apps/api"
  node_version    = "20.x"
  install_command = "cd ../.. && npm ci --workspaces --include-workspace-root"
}

resource "vercel_project" "client" {
  name           = "${var.application}-client"
  framework      = "nextjs"
  root_directory = "apps/client"
  node_version   = "20.x"
}

resource "vercel_project_domain" "api" {
  count = var.domain_name != "" ? 1 : 0

  project_id = vercel_project.api.id
  domain     = local.api_hostname
}

resource "vercel_project_domain" "client" {
  count = var.domain_name != "" ? 1 : 0

  project_id = vercel_project.client.id
  domain     = var.domain_name
}

resource "vercel_project_domain" "client_www" {
  count = var.domain_name != "" ? 1 : 0

  project_id = vercel_project.client.id
  domain     = "www.${var.domain_name}"
}

# ── API runtime env (GitHub secrets → Terraform → Vercel) ─────────────────────

resource "vercel_project_environment_variable" "api_database_url" {
  project_id = vercel_project.api.id
  key        = "DATABASE_URL"
  value      = var.database_url
  target     = ["production"]
}

resource "vercel_project_environment_variable" "api_domain_name" {
  count = var.domain_name != "" ? 1 : 0

  project_id = vercel_project.api.id
  key        = "DOMAIN_NAME"
  value      = var.domain_name
  target     = ["production"]
}

resource "vercel_project_environment_variable" "api_ebay_epn_campid" {
  count = var.ebay_epn_campid != "" ? 1 : 0

  project_id = vercel_project.api.id
  key        = "EBAY_EPN_CAMPID"
  value      = var.ebay_epn_campid
  target     = ["production"]
}

# NEXT_PUBLIC_* is inlined at build time — set before `vercel build` in CI.
resource "vercel_project_environment_variable" "client_api_base_url" {
  count = local.api_public_url != "" ? 1 : 0

  project_id = vercel_project.client.id
  key        = "NEXT_PUBLIC_API_BASE_URL"
  value      = local.api_public_url
  target     = ["production"]
}
