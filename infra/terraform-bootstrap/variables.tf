variable "application" {
  type    = string
  default = "autobody-part-sourcing"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "aws_region" {
  type    = string
  default = "us-west-2"
}

variable "github_owner" {
  type        = string
  description = "GitHub org or username that owns the repo"
}

variable "github_repo" {
  type        = string
  description = "GitHub repo name without the owner prefix"
}

variable "github_actions_environment" {
  type        = string
  description = "GitHub Actions environment name used on deploy jobs (OIDC sub claim)"
  default     = "production"
}
