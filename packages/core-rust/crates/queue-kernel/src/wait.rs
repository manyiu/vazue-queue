//! Wait time estimation.

/// Linear wait estimate in minutes: (position - serving) / throughput.
pub fn estimate_wait_minutes(position: u64, serving: u64, throughput_per_minute: u32) -> f64 {
    if throughput_per_minute == 0 {
        return f64::INFINITY;
    }
    if position <= serving {
        return 0.0;
    }
    let remaining = (position - serving) as f64;
    remaining / f64::from(throughput_per_minute)
}

/// Adaptive poll interval (seconds) based on distance from front.
pub fn adaptive_poll_interval_secs(position: u64, serving: u64) -> u64 {
    let distance = position.saturating_sub(serving);
    if distance < 50 {
        2
    } else if distance < 500 {
        5
    } else {
        30
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_at_front() {
        assert_eq!(estimate_wait_minutes(10, 10, 100), 0.0);
    }

    #[test]
    fn estimate_linear() {
        assert!((estimate_wait_minutes(200, 100, 100) - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn poll_adapts() {
        assert_eq!(adaptive_poll_interval_secs(1000, 0), 30);
        assert_eq!(adaptive_poll_interval_secs(10, 0), 2);
    }
}
