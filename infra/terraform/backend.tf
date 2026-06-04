terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.48"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 3.0"
    }
  }

  backend "s3" {
    bucket         = "autobody-tfstate-prod"
    key            = "prod/terraform.tfstate"
    region         = "us-west-2"
    encrypt        = true
    dynamodb_table = "autobody-tfstate-lock"
  }
}
