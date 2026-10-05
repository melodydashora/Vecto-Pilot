# Session admission and app return — October 5, 2026

Melody requested that returning to the web app retain the 60-minute session window
and that a new login warn the driver to log out of the prior live session first.

1. **`server/api/auth/auth.js`, `createDriverSession`:** Moved the helper to
   `server/lib/auth/driver-session.js`. Removed unconditional session replacement
   and the comment “Called inside a transaction. Updating the owner row serializes
   login with setup saves, Continue, logout and publication; hydrate one saved revision.”
   The replacement locks the owner before checking liveness and rejects an active
   session without changing its pointers or clock. Prior implementation is in
   parent commit `70c61893`.
2. **Password registration:** Removed the active session assignment. Required
   timestamps remain populated, but `session_id: null` prevents authentication.
   The existing web flow asks the driver to sign in after signup;
   creating an unseen live session would now block that first sign-in. The legacy
   response token remains bound to an unused UUID, never an unbound bearer token.
3. **Google exchange:** Removed the temporary new-account session, separate
   account/link transaction and later unconditional session replacement. Replaced
   “6. Create/update session (same upsert pattern as login endpoint)” and
   “verdict.kind === 'subject': already linked — nothing to write.” Account/link
   writes, admission and token signing now commit together. The existing unverified
   registrant adoption exception is retained and rechecked under locks.
4. **Google exchange comments/logs:** Removed precommit “new account complete” and
   “linked Google ID” logs, section narration, and the dated account transaction
   comment beginning “2026-09-10 (VP-003 / Astra A3c): users + driver_profiles +
   auth_credentials in ONE transaction.” Its rollback rationale remains next to
   the transaction. The prior comments about adopting an unverified password
   account and clearing its unproven phone/session are consolidated into that
   branch's current rationale. Full wording remains in parent commit `70c61893`.
5. **Password/Google token issuance:** Removed token signing after committing
   session creation, including “Generate token” / “7. Generate app token” comments.
   Local signing failure now rolls back the session rather than blocking retries.
6. **Documentation:** Replaced the preflight “Highlander Rule: One device per user
   (login on new device kills old session)” and AUTH's corresponding replacement
   descriptions. They contradicted Melody's current no-takeover requirement.
7. **Client logout:** Replaced the old best-effort request and its comment
   “Local teardown must not wait for the server or erase a subsequent login.”
   Immediate private-state teardown is preserved. A dedicated pending credential
   now supports explicit server-logout retry after network/non-success responses,
   a 15-second timeout, reload or tab change. Without this recovery, the new
   admission policy could leave a signed-out driver unable to end the prior live
   session. Late responses compare their credential before clearing pending state.
   Prior source and wording remain in parent commit `70c61893`.

The 60-minute inactivity and two-hour hard-limit policy constants are unchanged.

## Follow-up: lost login response recovery

Melody explicitly authorized fixing the remaining edge case recorded in continuity
517: a successful login whose response was lost before token storage could strand
the new session until expiry. The follow-up adds a pre-request browser proof and
an atomic server attempt receipt. It replaces that limitation for the upgraded web
client while preserving the no-takeover rule and original session/JWT clocks.
The old constraint remains applicable when proof storage is deleted or a legacy
client omits the proof; it is not a general account-recovery mechanism.
