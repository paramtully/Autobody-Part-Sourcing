provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.default_tags
  }
}

provider "vercel" {
  api_token = var.vercel_api_token
  team      = var.vercel_team_id != "" ? var.vercel_team_id : null
}
