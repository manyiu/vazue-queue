//! Sharded FIFO counter helpers.

#[derive(Debug, Clone, Copy)]
pub struct ShardPlan {
    pub shard_count: u32,
}

impl ShardPlan {
    pub fn new(shard_count: u32) -> Self {
        Self {
            shard_count: shard_count.max(1),
        }
    }
}

/// Deterministic shard assignment from session id.
pub fn assign_shard(session_id: &str, plan: ShardPlan) -> u32 {
    let mut hash: u32 = 2166136261;
    for b in session_id.as_bytes() {
        hash ^= u32::from(*b);
        hash = hash.wrapping_mul(16777619);
    }
    hash % plan.shard_count
}

/// Merge per-shard queue counters into a global approximate total.
pub fn merge_counter_shards(shards: &[u64]) -> u64 {
    shards.iter().copied().sum()
}

/// Next global position given prior total and this enrollment's shard local next.
pub fn next_global_position(prior_global: u64) -> u64 {
    prior_global.saturating_add(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_is_stable() {
        let plan = ShardPlan::new(8);
        let a = assign_shard("session-abc", plan);
        let b = assign_shard("session-abc", plan);
        assert_eq!(a, b);
        assert!(a < 8);
    }

    #[test]
    fn merge_sums() {
        assert_eq!(merge_counter_shards(&[1, 2, 3]), 6);
    }
}
