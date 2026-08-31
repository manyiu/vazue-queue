# Data model

DynamoDB tables (on-demand). Default region: **us-east-1**.

## Tables

| Table | PK | SK | Purpose |
|-------|----|----|---------|
| **Rooms** | tenantId | roomId | Theme, default queue config |
| **Events** | tenantId | eventId | Throughput, bot mode, live overrides, TTL |
| **Visitors** | eventId | requestId | Position, session, status, admit token, TTL |
| **Counters** | eventId | counterType | `queue#shardN`, `serving` — atomic ADD |

## Key access patterns

### Idempotent enroll

Visitors GSI **`bySession`**: PK `eventId`, SK `sessionId` — lookup existing visitor by browser session before assigning a new position.

### FIFO position

`Counters` row `queue#global` (or sharded `queue#shard{N}`) incremented atomically on enroll. Visitor record stores assigned position.

### Serving counter

`Counters` row `serving` — compared to visitor position on each status poll. When `position <= serving`, visitor is admitted.

### Sharding

`counterType = queue#shard{N}` for N in `0..counterShards-1`. Configurable via `queue.counterShards` (1–64).

## TTL

`Visitors.ttl` = enrolled_at + `visitorRecordTtlHours`. Serving reaper advances serving when front visitors expire.

## Related

- [Fairness & throughput](/docs/concepts/fairness-and-throughput)
- [Architecture](/docs/concepts/architecture)

Engineering reference: [dynamodb-models.md on GitHub](https://github.com/manyiu/vazue-queue/blob/main/docs/engineering/dynamodb-models.md).
