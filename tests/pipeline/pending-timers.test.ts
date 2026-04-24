import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #44 — pendingTimers leak: response handlers used to only delete
 * from pendingRequests, leaving the watchdog timer in pendingTimers
 * until it fired empty-handed. This guards the fix: every response
 * handler goes through settlePending() which clears the timer AND
 * drops it from pendingTimers in one place.
 */

const ORCH = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'pipeline', 'orchestrator.ts'),
  'utf8',
);

describe('orchestrator — pending-timer bookkeeping (#44)', () => {
  it('PendingRequest entries carry the timer handle so response handlers can clear it', () => {
    expect(ORCH).toMatch(/timer\?: ReturnType<typeof setTimeout>/);
  });

  it('settlePending() clears the watchdog + drops from pendingTimers before removing the entry', () => {
    expect(ORCH).toMatch(/private settlePending\(id: string\): void/);
    expect(ORCH).toMatch(/clearTimeout\(pending\.timer\)/);
    expect(ORCH).toMatch(/this\.pendingTimers\.delete\(pending\.timer\)/);
  });

  it('every response handler calls settlePending, not pendingRequests.delete directly', () => {
    // Response handlers (CV/ML/Inpaint/LaMa) live inside .onmessage
    // blocks. The only remaining pendingRequests.delete calls are
    // inside setTimeout callbacks (when the timer actually fires) +
    // rejectAllPending + abort + destroy — those are intentional.
    const onmessageBlocks = ORCH.match(/onmessage = [\s\S]*?^\s{4}\};/gm) ?? [];
    expect(onmessageBlocks.length).toBeGreaterThan(0);
    for (const block of onmessageBlocks) {
      expect(block).not.toMatch(/pendingRequests\.delete/);
      expect(block).toMatch(/settlePending/);
    }
  });

  it('every Call path attaches the timer to the pending request so settlePending can find it', () => {
    const calls = ['cvCall', 'mlCall', 'inpaintCall', 'lamaCall'];
    for (const fn of calls) {
      // Find the function body (greedy until the matching closing brace
      // of the surrounding method).
      const m = ORCH.match(new RegExp(`private ${fn}[\\s\\S]*?^  \\}$`, 'm'));
      expect(m, `${fn} body not matched`).not.toBeNull();
      expect(m![0], `${fn} should attach timer to pendingRequests entry`).toMatch(
        /pendingRequests\.set\(id, \{[^}]*\btimer\b[^}]*\}\)/,
      );
    }
  });

  it('destroy() clears both pendingTimers AND pendingRequests', () => {
    const destroyBody = ORCH.match(/destroy\(\): void \{[\s\S]*?^ {2}\}$/m);
    expect(destroyBody).not.toBeNull();
    expect(destroyBody![0]).toMatch(/pendingTimers\.clear\(\)/);
    expect(destroyBody![0]).toMatch(/pendingRequests\.clear\(\)/);
  });

  it('exposes _pendingTimersSize / _pendingRequestsSize read-only getters for tests', () => {
    expect(ORCH).toMatch(/get _pendingTimersSize\(\): number/);
    expect(ORCH).toMatch(/get _pendingRequestsSize\(\): number/);
  });
});
