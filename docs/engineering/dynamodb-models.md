# DynamoDB access patterns

Default region: **us-east-1**. All tables on-demand.

| Table | PK | SK | Notes |
|-------|----|----|-------|
| Rooms | tenantId | roomId | Theme, default queue config |
| Events | tenantId | eventId | Throughput, bot mode, live overrides, TTL |
| Visitors | eventId | requestId | Position, session, status, admit_token, ttl |
| Counters | eventId | counterType | `queue#shardN`, `serving` — atomic ADD |

## GSIs

- Visitors: GSI `bySession` — PK `eventId`, SK `sessionId` for idempotent enroll lookup.

## Sharding (enroll hot-key mitigation)

`counterType = queue#shard{N}` for N in `0..counterShards-1`. On enroll:

1. `ADD queue#shard{S}` where `S = hash(sessionId) % counterShards` (spreads writes across N counter items).
2. `position = sum(queue#shard0..N)` via consistent `BatchGetItem` (dense 1..N positions).
3. `PUT` visitor row with assigned `position`.

Admin `event_stats` uses the same shard sum for `queue_depth`. Status polls read only the visitor row + `serving` (no shard sum).

**Upgrade note:** Events that enrolled under the legacy `queue#global` counter must finish or be recreated before relying on shard-only positions. Mixing schemes mid-event can produce overlapping position numbers.

## TTL

Visitors.ttl = enrolled_at + visitor_record_ttl_hours. Serving reaper advances serving when front visitors expire.
