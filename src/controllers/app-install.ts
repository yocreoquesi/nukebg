/**
 * Controller for the PWA install affordance:
 *   - Toggles the install button between "install" / "installed".
 *   - Listens for `nukebg:pwa-installable` (dispatched by sw-register on
 *     `beforeinstallprompt`) to surface the native prompt path.
 *   - Falls back to a 2s mobile-only delayed appearance for browsers
 *     without `beforeinstallprompt` (Firefox / iOS Safari).
 *   - On click: triggers native prompt OR shows browser-specific guide.
 *
 * Extracted from ar-app.ts in #47/Phase-1b. Native-prompt and installed
 * detection live in `src/sw-register.ts`; this controller wires the UI
 * to those primitives. AbortSignal-based cleanup, no manual disconnect.
 */
import { installApp, isAppInstalled } from '../sw-register';
import { t } from '../i18n';

export class AppInstaller {
  private hasNativePrompt = false;

  constructor(
    private installBtn: HTMLButtonElement,
    private installGuide: HTMLDivElement,
  ) {}

  /** Wire up listeners + initial state. AbortSignal lifetime ties
   *  cleanup to the host component. */
  attach(signal: AbortSignal): void {
    if (isAppInstalled()) {
      this.installBtn.textContent = t('pwa.installed');
      this.installBtn.classList.add('visible');
      this.installBtn.disabled = true;
    }

    const onInstallable = () => {
      this.hasNativePrompt = true;
      if (!isAppInstalled()) {
        this.installBtn.textContent = t('pwa.install');
        this.installBtn.classList.add('visible');
        this.installBtn.disabled = false;
      }
    };
    document.addEventListener('nukebg:pwa-installable', onInstallable, { signal });

    // Firefox + iOS Safari can install via manual steps but never fire
    // `beforeinstallprompt`. Surface the button after a short delay if
    // the native prompt hasn't fired by then.
    const isMobile = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    if (isMobile && !isAppInstalled()) {
      setTimeout(() => {
        if (!this.hasNativePrompt && !signal.aborted) {
          this.installBtn.textContent = t('pwa.install');
          this.installBtn.classList.add('visible');
          this.installBtn.disabled = false;
        }
      }, 2000);
    }

    this.installBtn.addEventListener(
      'click',
      async () => {
        if (this.hasNativePrompt) {
          const accepted = await installApp();
          if (accepted) {
            this.installBtn.textContent = t('pwa.installed');
            this.installBtn.disabled = true;
            this.installGuide.classList.remove('visible');
          }
          return;
        }
        // Browser-specific instructions for non-Chromium installs.
        this.installGuide.innerHTML = this.buildGuide();
        this.installGuide.classList.toggle('visible');
        const closeBtn = this.installGuide.querySelector('.install-guide-close');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => this.installGuide.classList.remove('visible'), {
            signal,
          });
        }
      },
      { signal },
    );
  }

  /** Re-applies button text after a locale change. Host's updateTexts()
   *  calls this so the button stays in sync with the active locale. */
  refreshText(): void {
    this.installBtn.textContent = isAppInstalled() ? t('pwa.installed') : t('pwa.install');
    this.installBtn.setAttribute('aria-label', t('pwa.install'));
  }

  private buildGuide(): string {
    const ua = navigator.userAgent.toLowerCase();
    let steps: string;
    if (/firefox/i.test(ua)) {
      steps = t('pwa.guideFirefox');
    } else if (/iphone|ipad|ipod/i.test(ua)) {
      steps = t('pwa.guideSafari');
    } else {
      steps = t('pwa.guideGeneric');
    }
    return `<div class="guide-motivation">${t('pwa.guideMotivation')}</div>${steps}<br><button class="install-guide-close">${t('pwa.guideDismiss')}</button>`;
  }
}
