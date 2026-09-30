import { jest, describe, test, expect, beforeEach } from '@jest/globals';
let duringRead: (() => void) | undefined;
jest.unstable_mockModule('@/utils/coach/readCoachEvents', () => ({ readCoachEvents: async function* () {
  duringRead?.();
  yield { done: true, response_text: 'Synthetic completed answer', actions_result: { saved: 1, errors: [] } };
} }));
const { askCoachBrain } = await import('@/lib/voice/coachBrain');
beforeEach(() => { duringRead = undefined; global.fetch = jest.fn<typeof fetch>(async () => ({ ok: true, body: {} }) as Response); });
describe('Canonical Coach brain cancellation', () => {
  test('late completion cannot publish receipts, speak or retain a session abort listener', async () => {
    const controller = new AbortController(); const onActionsResult = jest.fn(); const onBrainAnswer = jest.fn();
    const add = jest.spyOn(controller.signal, 'addEventListener'); const remove = jest.spyOn(controller.signal, 'removeEventListener');
    duringRead = () => controller.abort();
    await expect(askCoachBrain({ userId: 'owner', signal: controller.signal, onActionsResult, onBrainAnswer }, 'Question')).rejects.toMatchObject({ name: 'AbortError' });
    expect(onActionsResult).not.toHaveBeenCalled(); expect(onBrainAnswer).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
  });
  test('an already ended session cannot begin a paid request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(askCoachBrain({ userId: 'owner', signal: controller.signal }, 'Question')).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
