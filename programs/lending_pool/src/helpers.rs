pub fn utilization_bps(total_borrowed: u64, total_deposited: u64) -> u64 {
    if total_deposited == 0 {
        return 0;
    }
    total_borrowed.saturating_mul(10_000) / total_deposited
}
