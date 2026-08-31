# DynamoDB access patterns

Default region: **us-east-1**. All tables on-demand.

| Table | PK | SK | Notes |
|-------|----|----|-------|
| Rooms | tenantId | roomId | Theme, default queue config |
| Events | tenantId | eventId | Throughput, bot mode, live overrides, TTL |
| Visitors | eventId | requestId | Position, session, status, admit_token, ttl |
| Counters | eventId | counterType | `queue#shardN`, `serving` — atomic ADD |
| Tokens | eventId | tokenId | Admit audit / idempotency |

## GSIs

- Visitors: GSI `bySession` — PK `eventId`, SK `sessionId` for idempotent enroll lookup.

## Sharding

`counterType = queue#shard{N}` for N in `0..counterShards-1`. Global position ≈ sum of shards or single logical counter advanced under conditional writes.

## TTL

Visitors.ttl = enrolled_at + visitor_record_ttl_hours. Serving reaper advances serving when front visitors expire.
