locals {
  # Applied to all taggable resources via provider default_tags (myApplications, Tag Editor, cost allocation).
  default_tags = {
    Application = var.application
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = "${var.github_owner}/${var.github_repo}"
  }
}
