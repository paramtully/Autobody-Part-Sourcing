# One-time Bootstrap

These steps must be performed **once manually** before the pipeline can run.
They cannot be automated because there is no prior trust anchor.

## 1. S3 Terraform state bucket + DynamoDB lock

After creating these resources, tag them in **Resource Groups → Tag Editor** (or CLI) so they appear in the same myApplications app as Terraform-managed resources:

| Key | Value |
|-----|--------|
| `Application` | `autobody-part-sourcing` |
| `Environment` | `prod` |
| `ManagedBy` | `manual` |

Apply to: S3 bucket `autobody-tfstate-prod`, DynamoDB table `autobody-tfstate-lock`, and secret `prod/supabase/database_url` (bootstrap-only; not in Terraform state).

```bash
# One line per command — avoids broken line continuations when copying from the doc.

aws s3api create-bucket --bucket autobody-tfstate-prod --region us-west-2 --create-bucket-configuration LocationConstraint=us-west-2

aws s3api put-bucket-versioning --bucket autobody-tfstate-prod --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption --bucket autobody-tfstate-prod --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block --bucket autobody-tfstate-prod --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

aws dynamodb create-table --table-name autobody-tfstate-lock --attribute-definitions AttributeName=LockID,AttributeType=S --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST --region us-west-2
```

## 2. GitHub Actions OIDC provider in AWS

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --region us-west-2
```

## 3. Create the deploy role (first local apply)

```bash
cd infra/terraform
terraform init
terraform apply -target=aws_iam_role.gh_deploy -target=aws_iam_role_policy.gh_deploy
```

Copy the printed role ARN into GitHub.

## 4. GitHub Secrets — add under a `production` Environment (Settings → Environments)

Restrict the environment to the `main` branch.

| Secret | Value |
|--------|-------|
| `AWS_DEPLOY_ROLE_ARN` | ARN from step 3 |
| `VERCEL_TOKEN` | Vercel personal access token |
| `VERCEL_ORG_ID` | Your Vercel team/org ID |
| `VERCEL_PROJECT_ID_API` | Vercel project ID for `apps/api` |
| `VERCEL_PROJECT_ID_CLIENT` | Vercel project ID for `apps/client` |
| `SUPABASE_MIGRATION_URL` | Supabase direct-connection URL with service-role creds |

## 5. AWS Secrets Manager — Supabase connection string

```bash
aws secretsmanager create-secret \
  --name prod/supabase/database_url \
  --secret-string "postgresql://..." \
  --region us-west-2
```

## 6. Vercel env vars for `apps/api` (SQS doorbell)

After `terraform apply` completes, copy:

- `OUTBOX_QUEUE_URL` — from `terraform output outbox_queue_url`
- `AWS_REGION` = `us-west-2`
- `AWS_ACCESS_KEY_ID` — from `terraform output api_publisher_access_key_id`
- `AWS_SECRET_ACCESS_KEY` — create the IAM access key manually:

```bash
aws iam create-access-key --user-name vercel-api-outbox-publisher
```

Set all four as **Encrypted** environment variables on the Vercel `apps/api` production project.

## 7. Branch protection on `main`

In GitHub → Settings → Branches → Add rule for `main`:
- Require status checks: `validate`
- Require at least 1 approving review
- Block force pushes
