# September 29, 2026 — redundant documentation cleanup

Melody explicitly requested removal of unnecessary, old and stale documents because
competing search results slow source investigation. This pass removes proven duplicates,
obsolete generated inventories and an empty file. It consolidates a small partial route
catalog into the existing registry and simplifies navigation. It does not certify every
remaining guide or mark old findings resolved.

## Removed files and retained content

| Removed file | Reason / retained source |
|---|---|
| `docs/review-queue/2026-01-14.md` | Byte-identical `docs/reviewed-queue/2026-01-14.md` remains. |
| `docs/review-queue/2026-01-15.md` | Reviewed counterpart retains the same record; only four file-table rows differ (`CoachChat.tsx` in removed copy, historical `AICoach.tsx` in retained copy). No finding was dropped. |
| `docs/review-queue/2026-01-26.md` | Byte-identical reviewed counterpart remains. |
| `docs/review-queue/2026-01-28.md` | Byte-identical reviewed counterpart remains. |
| `docs/review-queue/2026-01-31.md` | Byte-identical reviewed counterpart remains. |
| `docs/review-queue/2026-02-01.md` | Byte-identical reviewed counterpart remains. |
| `docs/review-queue/2026-02-02.md` | Byte-identical reviewed counterpart remains. |
| `docs/review-queue/FIX_PLAN_2026-02-01.md` | Byte-identical reviewed counterpart remains; archive navigation now links directly to it. This does not mark every historical plan item complete. |
| `docs/review-queue/IN_PROGRESS_WORKSTREAM.md` | Byte-identical reviewed counterpart remains; the body already identifies the January 5 workstream as completed. |
| `WORKFLOW_FILE_LISTING.md` | Generated January inventory explicitly labeled stale; many listed source paths no longer exist. Current indexes and source-file search serve its navigational purpose. |
| `docs/archive/WORKFLOW_FILE_LISTING.md` | Later generated inventory already labeled inaccurate, including irrelevant cache-library listings. No authored requirements depend on preserving a second source inventory. |
| `docs/architecture/district-tagging.md` | Byte-identical [DISTRICT_TAGGING.md](../DISTRICT_TAGGING.md) remains. |
| `docs/architecture/audits/llm_calls_audit_base.md` | Byte-identical `llm_calls_audit.md` initially retained; both stale catalogs now superseded by [source-linked role ownership](../../AI_ROLE_MAP.md), with subsequent removal recorded in [pipeline reconciliation](2026-09-29-pipeline-review.md). |
| `docs/architecture/API_REFERENCE.md` | Partial catalog duplicated [API routes registry](../../api-routes-registry.md). Unique note-delete/news/diagnostics rows were checked against handlers and consolidated there before removal; Analyzer detail remains in [its source trace](../OFFER_ANALYZER.md). |
| `generic-honking-cocke.md` | Empty tracked root file; no content or active dependency. |

These 15 files contained 8,344 lines. The duplicate records remain accessible through
their retained counterparts. Historical changed-file lists may still name the removed
paths; those are observations about earlier commits, not instructions to open a current file.

## Recovery and preservation

All removed paths exist at base commit `6e98390697dfd3d677702bc64fe206b2383f5279`:

```bash
git show 6e98390697dfd3d677702bc64fe206b2383f5279:path/from/the/table
```

Fourteen deleted files matched that commit byte for byte. The small uppercase API
reference had this session's Analyzer pointer update; that guidance remains in the
registry and Analyzer trace. Its precise pre-removal content is also preserved in the
existing private coordination receipts. No duplicate public archive was created.

Melody's specification, partnership documents and their source archives, security
evidence, unique audit/merge decisions, open plans and current handoffs remain. Files
read by runtime/tooling were checked: the root architecture pointer, Coach inbox,
platform research input and existing automation document targets remain available.
The manual `list-repo-files.js` generator can recreate the retired workflow listing;
it was not run or changed by this documentation-only pass.

## Navigation corrections

- `docs/README.md` and `docs/architecture/README.md` now link to existing source and
  focused references. Removed stale document counts, missing-file links, copied timing,
  startup/model tables and the old parallel pipeline sketch. Their prior sections are
  recoverable at the same base commit; startup details belong in actual configuration.
- The API registry now distinguishes public health probes from authenticated/operator
  diagnostics, and preserves the consolidated routes with source links. Its date does
  not claim every route was re-audited.
- Root README and glossary navigation now point directly to the retained route registry.
- Queue READMEs describe retained history and current continuity tools instead of the
  retired `pending.md` workflow and obsolete CLAUDE rule numbers.

Verification checks compare all retained Markdown links against the pre-cleanup
baseline, confirm deleted-file recovery and retained duplicate content, and check the
working diff. Application code and configuration are unchanged by this cleanup.

Observed results: 558 remaining relative-link occurrences checked; no newly missing
targets and no missing targets in the edited documents. Existing missing-link
occurrences fell from 742 to 63, mostly through removal of the stale inventories.
The remaining pre-existing broken links are outside this bounded cleanup; no claim
is made that every retained document is current. No inbound heading links depended
on removed index sections. Application/test fingerprints match the preceding verified
checkpoint, and `git diff --check` passes. No application tests or runtime starts were
needed for these documentation-only changes.
