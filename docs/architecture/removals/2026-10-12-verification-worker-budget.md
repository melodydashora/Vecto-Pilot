# Verification worker budget — October 12, 2026

Melody requested final verification before consolidating the finished app on main.
The verification command now runs the same backend suites with one worker and
recycles idle workers above 128 MB. A single-process run retained increasing
memory; both overlapping and standalone two-worker test runs caused operating-system
memory kills. The affected suite passed in isolation. This adjusts execution resources,
not test discovery, assertions, or product failure handling. Heavy release stages
run sequentially.

The replaced package.json command fragment is preserved exactly:

```text
npm run test:unit -- --runInBand && npm run test:node
```

Its replacement is:

```text
npm run test:unit -- --maxWorkers=1 --workerIdleMemoryLimit=128MB && npm run test:node
```
