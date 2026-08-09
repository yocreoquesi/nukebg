import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #44 — pendingTimers leak: response handlers used to only delete
 * from pendingRequests, leaving the watchdog timer in pendingTimers
 * until it fired empty-handed. This guards the fix.
 *
 * The plumbing now lives in `src/pipeline/worker-channel.ts` (extracted
 * from the orchestrator), so this regression guard reads that file.
 * The orchestrator still exposes `_pendingTimersSize` /
 * `_pendingRequestsSize` getters that aggregate across every channel.
 */

const ROOT = resolve(__dirname, '..', '..', 'src', 'pipeline');
const CHANNEL = readFileSync(resolve(ROOT, 'worker-channel.ts'), 'utf8');
const ORCH = readFileSync(resolve(ROOT, 'orchestrator.ts'), 'utf8');

describe('worker-channel — pending-timer bookkeeping (#44)', () => {
  it('PendingRequest entries carry the timer handle so response handlers can clear it', () => {
    expect(CHANNEL).toMatch(/timer\?: ReturnType<typeof setTimeout>/);
  });

  it('settlePending() clears the watchdog + drops from pendingTimers before removing the entry', () => {
    expect(CHANNEL).toMatch(/private settlePending\(id: string\): void/);
    expect(CHANNEL).toMatch(/clearTimeout\(pending\.timer\)/);
    expect(CHANNEL).toMatch(/this\.pendingTimers\.delete\(pending\.timer\)/);
  });

  it('the central onMessage handler settles via settlePending instead of touching pendingRequests directly', () => {
    const onMessageMatch = CHANNEL.match(
      /private onMessage\(msg: TMsg\): void \{[\s\S]*?^ {2}\}$/m,
    );
    expect(onMessageMatch, 'onMessage body not matched').not.toBeNull();
    const body = onMessageMatch![0];
    // The only pendingRequests access in onMessage should be the lookup,
    // never a direct delete — that path goes through settlePending.
    expect(body).not.toMatch(/pendingRequests\.delete/);
    expect(body).toMatch(/settlePending/);
  });

  it('call() attaches the timer to the pending request so settlePending can find it', () => {
    const callMatch = CHANNEL.match(/call<T>\([\s\S]*?^ {2}\}$/m);
    expect(callMatch, 'call() body not matched').not.toBeNull();
    expect(callMatch![0]).toMatch(/pendingRequests\.set\(id, \{[\s\S]*?\btimer\b[\s\S]*?\}\)/);
  });

  it('rejectAllPending clears both pendingTimers AND pendingRequests', () => {
    const body = CHANNEL.match(/rejectAllPending\(err: Error\): void \{[\s\S]*?^ {2}\}$/m);
    expect(body).not.toBeNull();
    expect(body![0]).toMatch(/pendingTimers\.clear\(\)/);
    expect(body![0]).toMatch(/pendingRequests\.clear\(\)/);
  });

  it('orchestrator exposes _pendingTimersSize / _pendingRequestsSize getters that aggregate across channels', () => {
    expect(ORCH).toMatch(/get _pendingTimersSize\(\): number/);
    expect(ORCH).toMatch(/get _pendingRequestsSize\(\): number/);
    // Aggregation: each channel's size is summed in.
    expect(ORCH).toMatch(/cv\.pendingTimersSize/);
    expect(ORCH).toMatch(/ml\.pendingTimersSize/);
    expect(ORCH).toMatch(/inpaint\.pendingTimersSize/);
    expect(ORCH).toMatch(/lama\.pendingTimersSize/);
  });

  it('channel exposes pendingTimersSize / pendingRequestsSize for the aggregator', () => {
    expect(CHANNEL).toMatch(/get pendingTimersSize\(\): number/);
    expect(CHANNEL).toMatch(/get pendingRequestsSize\(\): number/);
  });
});
