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

variable "vendors" {
  type = map(object({
    interval_ms         = number
    schedule_expression = string
  }))
  description = "Map of vendor_id -> { interval_ms (cooldown), schedule_expression (EventBridge rate) }"
  default = {
    # 3-hour ingestion cadence; EventBridge wakes every 15 min to check cooldown
    ebay = { interval_ms = 10800000, schedule_expression = "rate(15 minutes)" }
    # 6-hour ingestion cadence; EventBridge wakes every 30 min
    lkq = { interval_ms = 21600000, schedule_expression = "rate(30 minutes)" }
  }
}
