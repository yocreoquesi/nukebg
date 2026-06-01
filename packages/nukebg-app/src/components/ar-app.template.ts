/**
 * Shadow-DOM HTML template for <ar-app>.
 *
 * Extracted from ar-app.ts render() as part of the refactor in #254.
 * Returns the full shadow HTML string with styles embedded inside a <style>
 * tag, preserving the original injection mechanism (not adoptedStyleSheets).
 *
 * The `no-unsanitized/property` lint rule is enforced at the call site in
 * ar-app.ts (the innerHTML assignment), not here. All dynamic interpolations
 * are either AR_APP_STYLES (a static project-owned constant) or t(...)
 * (the trusted i18n helper). No user input is interpolated.
 */
import { AR_APP_STYLES } from './ar-app.styles';
import { t } from '../i18n';
import { isAppInstalled } from '../sw-register';

export function renderArAppTemplate(): string {
  return `
      <style>${AR_APP_STYLES}</style>

      <!-- Full-bleed marquee outside the main column per design #69.
           Gradient mask fades text in/out at the edges so it never
           clips mid-word the way the old column-scoped marquee did. -->
      <div class="marquee-bleed" id="precision-marquee-bleed"><span><span class="marquee-half">☢ NUKEBG | DROP. NUKE. DOWNLOAD. | <span data-marquee-runtime>development funded for 0 months — tip to extend runway</span> | nukebg.app ☢</span><span class="marquee-half" aria-hidden="true">☢ NUKEBG | DROP. NUKE. DOWNLOAD. | <span data-marquee-runtime>development funded for 0 months — tip to extend runway</span> | nukebg.app ☢</span></span></div>

      <section class="hero" id="hero">
        <h1>
          <span class="hero-title-long"><span class="accent">${t('hero.title.accent')}</span> ${t('hero.title.rest')}</span>
          <span class="hero-title-short"><span class="accent">${t('hero.title.short')}</span></span>
        </h1>
        <p class="subline">
          <span class="subline-long">${t('hero.subtitle').replace(/\n/g, ' ')}</span>
          <span class="subline-short"># ${t('hero.subtitle.short')}</span>
        </p>
        <ar-dropzone></ar-dropzone>
        <ar-batch-grid id="batch-grid" style="display:none"></ar-batch-grid>

        <button class="install-btn" id="install-btn" aria-label="${t('pwa.install')}">${isAppInstalled() ? t('pwa.installed') : t('pwa.install')}</button>
        <div class="install-guide" id="install-guide"></div>
      </section>

      <section class="workspace" id="workspace" aria-label="Image processing workspace">
        <div class="workspace-inner">
          <div class="batch-detail-bar" id="batch-detail-bar" style="display:none">
            <button class="back-to-grid-btn" id="back-to-grid-btn">${t('batch.backToGrid')}</button>
          </div>
          <div class="batch-failed-bar" id="batch-failed-bar" style="display:none">
            <button class="batch-retry-btn" id="batch-retry-btn">${t('batch.retry')}</button>
            <button class="batch-discard-btn" id="batch-discard-btn">${t('batch.discard')}</button>
          </div>
          <div class="single-file-workspace" id="single-file-workspace">
          <!-- Two-column workspace at ≥ 900 px: viewer on the left,
               action column (download, edit, advanced) on the right
               so the result gets immediate presence next to the
               delivery mechanism. At smaller widths the column
               collapses below the viewer and everything stacks. (#75) -->
          <div class="ws-result-grid">
            <div class="ws-viewer-col">
              <ar-viewer></ar-viewer>
              <ar-progress></ar-progress>
            </div>
            <div class="ws-action-col" id="ws-action-col">
              <ar-download></ar-download>
              <button class="edit-btn" id="edit-btn" style="display:none">${t('edit.btn')}</button>
              <p class="advanced-prompt" id="advanced-prompt" style="display:none">${t('advanced.cta')}</p>
              <button class="advanced-cta" id="advanced-cta" style="display:none">${t('advanced.btn')}</button>
            </div>
          </div>
          <!-- Command bar moved BELOW the viewer / action grid: the
               user did not want "$ nuke file.png · ... · ready"
               appearing ABOVE the image when processing finished or
               was cancelled. The bar still owns the same status
               role / aria-live region; only the DOM position
               changed. -->
          <div class="command-bar" id="command-bar" role="status" aria-live="polite">
            <div class="cmd-left">
              <span class="cmd-prompt">$</span>
              <span class="cmd-action">nuke</span>
              <span class="cmd-filename" id="cmd-filename">image.png</span>
              <span class="cmd-meta" id="cmd-meta"></span>
              <span class="cmd-state" id="cmd-state" hidden>
                <span class="cmd-state-dot">●</span>
                <span class="cmd-state-label" id="cmd-state-label">${t('cmdbar.running')}</span>
              </span>
            </div>
          </div>
          <ar-editor style="display:none" id="editor-section"></ar-editor>
          <ar-editor-advanced id="editor-advanced"></ar-editor-advanced>
          </div>
        </div>
      </section>

      <!-- Status panel: placed BELOW the workspace so it always reads
           "in context" of the current image (or sits below the dropzone
           on the landing screen, since .workspace is display:none until
           a file is dropped). Lifted out of section.hero on purpose —
           that section gets a .hidden class toggled when the workspace
           takes over, which used to make the [STATUS] line and the
           honesty copy disappear during processing. The
           .status-panel.editor-open rule hides this block while the
           advanced editor is open (the only state where the user
           actively does NOT want the [STATUS] / Ko-fi noise on screen).
           Class names and IDs kept (.status-line, .hero-disclaimer,
           .hero-support) so existing CSS selectors and the regex-based
           component tests still match. -->
      <aside class="status-panel" id="status-panel">
        <p class="status-line" id="status-line">
          <span class="status-tag">[STATUS]</span>
          <span class="status-dot">●</span>
          <span class="status-reactor" id="status-reactor" data-state="offline">${t('status.reactor.offline')}</span>
          <span class="status-sep">|</span>
          <span class="status-model" id="status-model" data-state="loading">${t('status.model.loading')}</span>
          <span class="status-sep">|</span>
          <details class="status-details">
            <summary id="status-limits-summary"># ${t('status.limitations')}</summary>
            <div class="status-limits-body" id="status-limits-body">${t('features.limitations')}</div>
          </details>
        </p>
        <p class="hero-disclaimer" id="hero-disclaimer">${t('features.disclaimer')}</p>
        <p class="hero-support" id="hero-support">${t('support.kofi')}</p>
      </aside>

      <div
        class="error-modal"
        id="error-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-modal-title"
        aria-describedby="error-modal-message"
        hidden
      >
        <div class="error-modal-backdrop" id="error-modal-backdrop"></div>
        <div class="error-modal-dialog">
          <h2 class="error-modal-title" id="error-modal-title">${t('error.title')}</h2>
          <p class="error-modal-message" id="error-modal-message"></p>
          <div class="error-modal-actions">
            <button type="button" class="error-modal-btn primary" id="error-modal-retry">${t('error.retry')}</button>
            <button type="button" class="error-modal-btn" id="error-modal-dismiss">${t('error.dismiss')}</button>
          </div>
        </div>
      </div>
    `;
}
