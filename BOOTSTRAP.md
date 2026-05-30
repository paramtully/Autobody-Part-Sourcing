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

Apply to: S3 bucket `autobody-tfstate-prod` and DynamoDB table `autobody-tfstate-lock`.

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

The role trust policy must allow `repo:<owner>/<repo>:environment:production` because **Deploy** runs via `workflow_run` with the `production` environment (OIDC `sub` is not `ref:refs/heads/main`). If `configure-aws-credentials` fails with `Not authorized to perform sts:AssumeRoleWithWebIdentity`, re-apply the role after updating `github_oidc.tf`:

```bash
terraform apply -target=aws_iam_role.gh_deploy
```

**Terraform >= 1.9** is required (`infra/terraform/backend.tf`). Check with `terraform version`.

- Homebrew: `brew upgrade terraform` (if upgrade fails, fix Cellar ownership per Homebrew's hint, then retry).
- [tfenv](https://github.com/tfutils/tfenv): `cd infra/terraform && tfenv install` (uses `.terraform-version`, currently **1.9.8**).
- Or download from [releases.hashicorp.com/terraform](https://releases.hashicorp.com/terraform/).

```bash
cd infra/terraform
terraform init
terraform apply -target=aws_iam_role.gh_deploy -target=aws_iam_role_policy.gh_deploy
```

Copy the printed role ARN into GitHub.

## 4. GitHub Secrets — add under a `production` Environment (Settings → Environments)

Restrict the environment to the `main` branch.

**All app secrets live here.** Terraform distributes them to the correct runtime — Lambdas or Vercel — without any intermediate store.

| Secret | Value |
|--------|-------|
| `AWS_DEPLOY_ROLE_ARN` | ARN from step 3 |
| `VERCEL_TOKEN` | Vercel personal access token |
| `DATABASE_URL` | Supabase connection string for Vercel API and listing Lambdas (pooler or session/direct — see below) |
| `SUPABASE_MIGRATION_URL` | (Optional) Supabase URL for CI `npm run db:migrate` — if unset, deploy uses `DATABASE_URL` |
| `EBAY_API_KEY` | eBay developer app client ID |
| `EBAY_API_SECRET` | eBay developer app client secret |
| `EBAY_USER_REFRESH_TOKEN` | eBay user refresh token for Trading API |
| `EBAY_RU_NAME` | (Optional) eBay RuName for user OAuth |
| `EBAY_EPN_CAMPID` | (Optional) Affiliate link campaign ID — Vercel API only; US/CA MKRIDs are built into the API |

> eBay Partner Network MKRIDs for `ebay.com` and `ebay.ca` are hardcoded in the affiliate package (not env vars).

> **`EBAY_API_URL` is not a production secret.** The listing workers default to `https://api.ebay.com` when the variable is unset. Set it in your local `.env` only when you need the sandbox endpoint.

**Repository or environment variables** (Settings → Actions → Variables, not encrypted):

| Variable | Value |
|----------|-------|
| `DOMAIN_NAME` | `getboneyard.com` (apex only, no `https://`) |
| `VERCEL_ORG_ID` | Vercel team ID — **must be the team that owns `getboneyard.com`** (Settings → General → Team ID, or from the dashboard URL) |

Deploy health checks use `https://api.<DOMAIN_NAME>/health` and `https://<DOMAIN_NAME>` automatically.

### Supabase URLs (`DATABASE_URL` vs `SUPABASE_MIGRATION_URL`)

You do not need a separate local env var for migrations unless you want one.

In **Supabase** → **Project Settings** → **Database** → **Connection string**:

| Mode | Typical host | Use |
|------|----------------|-----|
| **Session pooler** | `aws-0-…pooler.supabase.com:5432` | CI live tests, migrations, IPv4-only hosts |
| **Transaction pooler** | `aws-0-…pooler.supabase.com:6543` | Serverless (Vercel, Lambda) at scale |
| **Direct** | `db.<ref>.supabase.co:5432` | IPv6 networks only — **not** GitHub Actions |

Supabase **direct** URLs resolve to IPv6 only. GitHub Actions runners are IPv4-only, so CI DB smoke tests fail with `connect ENETUNREACH 2600:…:5432` when `DATABASE_URL` points at `db.<ref>.supabase.co`.

- Set GitHub secret **`DATABASE_URL`** to a **Supavisor pooler** URL (session or transaction mode). This is what Vercel, Lambda, and CI need.
- Set **`SUPABASE_MIGRATION_URL`** only if migrations need a **different** pooler string (e.g. session pooler on `:5432` while runtime uses transaction pooler on `:6543`). If one pooler URL works for both, set **`DATABASE_URL` only** — the migrate job falls back to it.

## 5. Vercel — projects, domains, and env vars (Terraform)

Vercel **projects**, **custom domains**, and **production env vars** are managed in `infra/terraform/vercel.tf`. Application **code** is still deployed by GitHub Actions (`vercel build` / `vercel deploy`).

The domain `getboneyard.com` was purchased in Vercel, so DNS is managed by Vercel — no external registrar step. Terraform attaches the hostnames to the correct projects:

| Host | Project |
|------|---------|
| `getboneyard.com` | `autobody-part-sourcing-client` |
| `www.getboneyard.com` | `autobody-part-sourcing-client` |
| `api.getboneyard.com` | `autobody-part-sourcing-api` |

`NEXT_PUBLIC_API_BASE_URL` is derived automatically as `https://api.getboneyard.com` once `DOMAIN_NAME` is set.

### Local Terraform apply

Export the same keys that GitHub passes as `TF_VAR_*`:

```bash
cd infra/terraform
export TF_VAR_vercel_api_token="..."           # same as VERCEL_TOKEN
export TF_VAR_vercel_team_id="..."             # same as VERCEL_ORG_ID variable
export TF_VAR_domain_name="getboneyard.com"
export TF_VAR_database_url="postgresql://..."
export TF_VAR_ebay_api_key="..."
export TF_VAR_ebay_api_secret="..."
export TF_VAR_ebay_user_refresh_token="..."
export TF_VAR_ebay_ru_name="..."               # optional
terraform apply
```

**Import an existing API project** (if you already ran `vercel link` in `apps/api`):

```bash
terraform import vercel_project.api prj_XXXX
```

**Import existing domain attachments** (if already linked in the Vercel dashboard):

```bash
terraform import 'vercel_project_domain.client[0]' getboneyard.com
terraform import 'vercel_project_domain.client_www[0]' www.getboneyard.com
terraform import 'vercel_project_domain.api[0]' api.getboneyard.com
```

### First-time migration (existing AWS accounts with old Secrets Manager secrets)

1. Confirm `DATABASE_URL` in GitHub matches what listing Lambdas need (compare with `prod/supabase/database_url` if they diverged).
2. Run `terraform apply` with the new code — Lambdas pick up env vars from `TF_VAR_*` instead of Secrets Manager.
3. After confirming Lambdas and Vercel API connect, delete the orphaned secrets:

```bash
aws secretsmanager delete-secret --secret-id prod/ebay/api --force-delete-without-recovery --region us-west-2
aws secretsmanager delete-secret --secret-id prod/supabase/database_url --force-delete-without-recovery --region us-west-2
```

Also remove any orphaned `OUTBOX_QUEUE_URL` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` env vars from the Vercel API project in the dashboard (payment outbox infra was removed).

## 6. Branch protection on `main`

In GitHub → Settings → Branches → Add rule for `main`:
- Require status checks: `App Validation` and `live-tests`
- Require at least 1 approving review
- Block force pushes

## 7. Tests

- `npm test` — unit tests (stubbed env, no network). Runs on every push/PR.
- `npm run test:live` — integration smoke tests against real eBay + Supabase. Requires credentials in `.env` locally (`LIVE_TESTS=1` is set automatically by the script). Runs automatically on `main` push in CI via the `live-tests` job.

**Secret rotation note:** changing a GitHub secret does not automatically trigger a redeploy. To push rotated credentials to Lambdas or Vercel, touch any file in `infra/` and push to `main`, or re-run the relevant deploy job manually.
