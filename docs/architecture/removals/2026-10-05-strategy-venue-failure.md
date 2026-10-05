# Strategy venue failure handling — October 5, 2026

1. `server/api/strategy/blocks-fast.js`, `ensureSmartBlocksExist`: replaced the post-failure `status: STRATEGY_STATUS.OK` update with `FAILED` and a safe failure message. The saved Strategy text remains intact. Previously the admission was failed but canonical readers saw Strategy `ok` with no ranking and returned pending forever. Regressions now exercise the actual generator and polling route together.

2. The removed comment `// Poll with exponential backoff (max 30s)` understated the actual 40-second wait. The wait remains bounded, but completion of that local wait is now a pending result while the claimed owner's work continues. Removed return: `{ ranking: null, generated: false, error: 'generation_timeout' }`. Both original and duplicate POST paths return202 instead of claiming provider failure. The current admission is rechecked during every wait iteration; this does not permit a failed or superseded run to restart providers.

3. GET previously treated any missing ranking as ongoing work, including a provider failure that had just ended the admission. It now returns a terminal error for an actual helper error and keeps pending responses for active shared work. Successful source/admission checks and completion writes are unchanged. Original code is preserved at base `7a1a7680e6c531d6ce36d73d109d0c2fdb23aeb4`.
