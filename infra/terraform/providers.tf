provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.default_tags
  }
}

# IAM resources use a provider without default_tags so CI can CreateRole without iam:TagRole.
# gh-actions-deploy omits TagRole intentionally; listing_exec is tagged via Lambda instead.
provider "aws" {
  alias  = "iam"
  region = var.aws_region
}

provider "vercel" {
  api_token = var.vercel_api_token
  team      = var.vercel_team_id != "" ? var.vercel_team_id : null
}
