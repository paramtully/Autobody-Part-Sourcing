# Vendor Inventory Polling Strategy

## Overview

This document outlines the polling strategy for vendor inventory ingestion, including default intervals, vendor capability integration, and scheduler optimization.

## Default Polling

### Startup Safe Default

- **Default Interval**: 30 minutes for all vendors
- **Rationale**: Balances freshness with API load and cost
- **Adjustable**: Per-vendor based on capability metadata

## Vendor Capability Integration

### Capability Metadata

Each vendor exposes capability metadata via `VendorInventoryClient.getVendorCapabilities()`:

```typescript
{
  supportsStreaming: boolean;
  supportsRealtimeLookup: boolean;
  supportsImages: boolean;
  supportsFitment: boolean;
  supportsBulkPagination: boolean;
  expectedUpdateFrequencyMinutes: number; // Key for polling optimization
  maxRecordsPerRequest?: number;
  rateLimitRequestsPerMinute?: number;
}
```

### Polling Frequency Optimization

#### High-Frequency Vendors

- **Criteria**: `expectedUpdateFrequencyMinutes < 60`
- **Action**: Poll more frequently (e.g., every 15 minutes)
- **Example**: Vendor updates every 30 minutes → poll every 15 minutes

#### Medium-Frequency Vendors

- **Criteria**: `60 <= expectedUpdateFrequencyMinutes < 240`
- **Action**: Use default polling (30 minutes)
- **Example**: Vendor updates every 2 hours → poll every 30 minutes

#### Low-Frequency Vendors

- **Criteria**: `expectedUpdateFrequencyMinutes >= 240`
- **Action**: Poll less frequently (e.g., every 60-120 minutes)
- **Example**: Vendor updates daily → poll every 2 hours

#### Realtime Lookup Support

- **Criteria**: `supportsRealtimeLookup === true`
- **Action**: Consider webhooks/push if available, otherwise poll on-demand
- **Future**: Webhook support for real-time updates

## Scheduler Optimization

### Staggering Vendor Polls

- **Problem**: Thundering herd if all vendors polled simultaneously
- **Solution**: Stagger vendor polls across time window
- **Implementation**: Add random offset (0-5 minutes) to each vendor's poll time

### Rate Limit Respect

- **Problem**: Exceeding vendor rate limits
- **Solution**: Use `rateLimitRequestsPerMinute` from capability metadata
- **Implementation**: 
  - Track requests per vendor
  - Throttle requests to respect rate limit
  - Queue requests if rate limit exceeded

### Health Check Integration

- **Problem**: Polling unhealthy vendors wastes resources
- **Solution**: Skip polls if vendor health check fails
- **Implementation**:
  - Run health check before scheduled poll
  - If `status === 'down'`, skip poll and log
  - If `status === 'degraded'`, poll with reduced frequency

### Exponential Backoff on Failures

- **Problem**: Repeated failures waste resources
- **Solution**: Exponential backoff on consecutive failures
- **Implementation**:
  - Track consecutive failures per vendor
  - Increase poll interval: `baseInterval * 2^failures`
  - Reset on successful poll
  - Cap maximum interval (e.g., 24 hours)

## Polling Schedule Example

```
Vendor A (high-frequency, updates every 30 min):
  - Poll every 15 minutes
  - Stagger: +2 minutes offset
  - Health check: before each poll

Vendor B (medium-frequency, updates every 2 hours):
  - Poll every 30 minutes (default)
  - Stagger: +4 minutes offset
  - Health check: before each poll

Vendor C (low-frequency, updates daily):
  - Poll every 2 hours
  - Stagger: +1 minute offset
  - Health check: before each poll
```

## Scheduler Implementation

### EventBridge / Cron

- **Trigger**: Scheduled rule (e.g., every 30 minutes)
- **Handler**: Ingestion worker
- **Per-Vendor**: Each vendor has independent schedule based on capabilities

### Worker Distribution

- **Concurrent**: Multiple vendors can be polled concurrently
- **Isolation**: One vendor's failure doesn't block others
- **Scaling**: Horizontal scaling via multiple workers

## Future Enhancements

### Webhook Support

- **Vendors with webhooks**: No polling needed
- **Implementation**: Webhook endpoint receives vendor updates
- **Fallback**: Poll if webhook not received within expected interval

### Incremental Updates

- **Vendors with delta APIs**: Only fetch changes
- **Optimization**: Reduce API load and processing time
- **Implementation**: Track last successful poll timestamp

### Priority-Based Polling

- **High-value vendors**: Poll more frequently
- **Low-value vendors**: Poll less frequently
- **Dynamic**: Adjust based on business metrics

### Adaptive Polling

- **Machine learning**: Predict optimal poll frequency
- **Factors**: Historical update patterns, time of day, day of week
- **Optimization**: Minimize API load while maximizing freshness

## Monitoring & Alerting

### Metrics

- Poll success rate per vendor
- Poll latency per vendor
- Consecutive failures per vendor
- Rate limit violations per vendor

### Alerts

- Vendor health check failures
- Consecutive poll failures (> 3)
- Rate limit violations
- Poll latency spikes

## Configuration

### Per-Vendor Override

Allow manual override of polling frequency:
- Via configuration file
- Via admin UI
- Via API

### Global Settings

- Default polling interval
- Maximum polling interval
- Minimum polling interval
- Stagger window size
