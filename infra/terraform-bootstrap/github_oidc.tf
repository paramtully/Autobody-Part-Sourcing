# GitHub OIDC provider is created during bootstrap (BOOTSTRAP.md step 2). Its ARN is
# deterministic per account — no iam:ListOpenIDConnectProviders lookup needed.
locals {
  github_oidc_provider_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
}

# Role assumed by GitHub Actions via OIDC — no long-lived keys ever stored.
# Deploy runs on workflow_run with environment: production → sub is :environment:production,
# not :ref:refs/heads/main (that claim is for workflows triggered directly by push).
#
# Managed only from this bootstrap root module (admin credentials). CI applies infra/terraform
# using this role and must not manage the role itself — that creates refresh permission loops.
resource "aws_iam_role" "gh_deploy" {
  name = "gh-actions-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = [
            "repo:${var.github_owner}/${var.github_repo}:environment:${var.github_actions_environment}",
            "repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/main",
          ]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "gh_deploy" {
  name = "gh-actions-deploy-policy"
  role = aws_iam_role.gh_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "LambdaDeploy"
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionCode",
          "lambda:UpdateFunctionConfiguration",
          "lambda:GetFunction",
          "lambda:CreateFunction",
          "lambda:DeleteFunction",
          "lambda:AddPermission",
          "lambda:RemovePermission",
          "lambda:GetPolicy",
          "lambda:CreateEventSourceMapping",
          "lambda:UpdateEventSourceMapping",
          "lambda:DeleteEventSourceMapping",
          "lambda:GetEventSourceMapping",
          "lambda:ListEventSourceMappings",
          "lambda:PublishVersion",
          "lambda:TagResource",
          "lambda:ListTags",
        ]
        Resource = "*"
      },
      {
        Sid    = "IAMPassRole"
        Effect = "Allow"
        Action = ["iam:PassRole", "iam:GetRole", "iam:CreateRole", "iam:DeleteRole",
          "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:PutRolePolicy",
          "iam:DeleteRolePolicy", "iam:GetRolePolicy", "iam:ListRolePolicies",
          "iam:TagRole", "iam:UntagRole", "iam:UpdateAssumeRolePolicy",
        ]
        Resource = "*"
      },
      {
        Sid      = "EventBridge"
        Effect   = "Allow"
        Action   = ["events:*"]
        Resource = "*"
      },
      {
        Sid    = "TerraformState"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket",
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = [
          "arn:aws:s3:::autobody-tfstate-prod",
          "arn:aws:s3:::autobody-tfstate-prod/*",
          "arn:aws:dynamodb:${var.aws_region}:*:table/autobody-tfstate-lock",
        ]
      },
    ]
  })
}
