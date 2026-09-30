// Deterministic admission boundary for pipeline unit tests. The actual SQL owner
// lock/revision checks are exercised by the dedicated admission tests.
export class MainRunAdmissionError extends Error {
  constructor(status = 409, code = 'main_run_superseded', message = code) {
    super(message); this.status = status; this.code = code;
  }
}

export function mainRunBoundary(db, configuration = { profile: {}, vehicle: {}, rules: { config: {}, version: 1, hash: 'fixture' } }) {
  const state = { allowed: true, configuration, status: 'running' };
  const assertMainRunForSnapshot = async () => {
    if (!state.allowed) throw new MainRunAdmissionError();
    return { user_id: 'fixture-owner', run_id: 'fixture-run', configuration: state.configuration, status: state.status };
  };
  const withCurrentMainRun = async (_snapshotId, callback) => {
    const admission = await assertMainRunForSnapshot();
    return db.transaction(tx => callback(tx, admission));
  };
  return { state, exports: { MainRunAdmissionError, assertMainRunForSnapshot, withCurrentMainRun } };
}
