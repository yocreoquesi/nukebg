import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/components/ar-progress';
import type { ArProgress } from '../../src/components/ar-progress';
import type { PipelineStage, StageStatus } from '../../src/types/pipeline';

/**
 * Regression tests for ar-progress rendering — specifically the batch
 * detail-view replay path. The bug that motivated these tests: after
 * all batch items finished, opening any done item showed the stage
 * labels ("Scanning image...", "Removing watermark", "Removing
 * background [ML]") without icons. Root cause: openBatchDetail called
 * progress.reset() which puts every stage in 'pending', and
 * getIcon('pending') returns an empty string. The fix replays each
 * item's captured StageSnapshot history via setStage so the final
 * status (done/skipped/error) is restored and icons render.
 *
 * These tests lock that behavior in from the component side: after
 * reset() + a sequence of setStage calls, the rendered DOM must contain
 * the right SVG icons, not blanks.
 */

type Snapshot = { stage: PipelineStage; status: StageStatus; message?: string };

function mount(): ArProgress {
  const el = document.createElement('ar-progress') as ArProgress;
  document.body.appendChild(el);
  return el;
}

function stageEls(el: ArProgress): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll('.stage')) as HTMLElement[];
}

function iconHtml(stageEl: HTMLElement): string {
  return stageEl.querySelector('.stage-icon')!.innerHTML.trim();
}

function replay(el: ArProgress, history: Snapshot[]): void {
  el.reset();
  for (const s of history) el.setStage(s.stage, s.status, s.message);
}

describe('ar-progress — replay after reset', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('after reset() alone, every icon slot is empty (this is the bug we fix)', () => {
    const el = mount();
    el.reset();
    const stages = stageEls(el);
    expect(stages.length).toBeGreaterThan(0);
    for (const s of stages) {
      expect(iconHtml(s)).toBe('');
    }
  });

  it('replays a full success history — every visible stage has a done icon', () => {
    const el = mount();
    const history: Snapshot[] = [
      { stage: 'detect-background', status: 'running' },
      { stage: 'detect-background', status: 'done', message: 'solid detected [photo]' },
      { stage: 'watermark-scan', status: 'running' },
      { stage: 'watermark-scan', status: 'done', message: 'found' },
      { stage: 'inpaint', status: 'running' },
      { stage: 'inpaint', status: 'done' },
      { stage: 'ml-segmentation', status: 'running' },
      { stage: 'ml-segmentation', status: 'done', message: '42% nuked' },
    ];
    replay(el, history);
    const stages = stageEls(el);
    // 4 stages: detect-bg, watermark-scan, inpaint, ml-segmentation
    expect(stages).toHaveLength(4);
    for (const s of stages) {
      expect(s.className).toContain('done');
      // Done icon is a checkmark <polyline>
      expect(iconHtml(s)).toContain('<polyline');
    }
  });

  it('hides the inpaint row when replay marks it as skipped (no watermark)', () => {
    const el = mount();
    const history: Snapshot[] = [
      { stage: 'detect-background', status: 'done', message: 'solid detected [photo]' },
      { stage: 'watermark-scan', status: 'done', message: 'none' },
      { stage: 'inpaint', status: 'skipped' },
      { stage: 'ml-segmentation', status: 'done', message: '18% nuked' },
    ];
    replay(el, history);
    const stages = stageEls(el);
    // inpaint row is filtered out when status === 'skipped'
    expect(stages).toHaveLength(3);
    for (const s of stages) {
      expect(iconHtml(s)).not.toBe('');
    }
  });

  it('replays a failure history — final stage shows the error icon', () => {
    const el = mount();
    const history: Snapshot[] = [
      { stage: 'detect-background', status: 'done', message: 'complex detected [photo]' },
      { stage: 'watermark-scan', status: 'done', message: 'none' },
      { stage: 'ml-segmentation', status: 'error', message: 'model load failed' },
    ];
    replay(el, history);
    const stages = stageEls(el);
    const errorStage = stages.find((s) => s.className.includes('error'));
    expect(errorStage).toBeDefined();
    // Error icon draws two crossing <line> elements
    expect(iconHtml(errorStage!)).toContain('<line');
  });

  it('replaying a second history fully overrides the first (no icon leak)', () => {
    const el = mount();
    // First: full success with inpaint
    replay(el, [
      { stage: 'detect-background', status: 'done' },
      { stage: 'watermark-scan', status: 'done' },
      { stage: 'inpaint', status: 'done' },
      { stage: 'ml-segmentation', status: 'done' },
    ]);
    expect(stageEls(el)).toHaveLength(4);

    // Second: success with inpaint skipped — the inpaint row must
    // disappear, not linger from the previous replay.
    replay(el, [
      { stage: 'detect-background', status: 'done' },
      { stage: 'watermark-scan', status: 'done' },
      { stage: 'inpaint', status: 'skipped' },
      { stage: 'ml-segmentation', status: 'done' },
    ]);
    const stages = stageEls(el);
    expect(stages).toHaveLength(3);
    for (const s of stages) {
      expect(iconHtml(s)).not.toBe('');
    }
  });
});
