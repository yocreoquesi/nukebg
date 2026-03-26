// Import styles
import './styles/main.css';

// i18n — importar antes de los componentes para que detecte el locale
import { getLocale, setLocale, t } from './i18n';

// Register Web Components
import './components/ar-dropzone';
import './components/ar-viewer';
import './components/ar-progress';
import './components/ar-download';
import './components/ar-privacy';
import './components/ar-editor';
import './components/ar-app';

// Register Service Worker
import './sw-register';

// === Keyboard Shortcuts ===
function initKeyboardShortcuts(): void {
  const toast = document.getElementById('kbd-toast');
  let toastTimeout: ReturnType<typeof setTimeout> | null = null;

  const showToast = (msg: string) => {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('visible');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('visible'), 1800);
  };

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+S: download result
    if (ctrl && e.key === 's') {
      e.preventDefault();
      // Find the download link in ar-download shadow DOM
      const arApp = document.querySelector('ar-app');
      if (!arApp?.shadowRoot) return;
      const arDownload = arApp.shadowRoot.querySelector('ar-download');
      if (!arDownload?.shadowRoot) return;
      const link = arDownload.shadowRoot.querySelector('#download-btn') as HTMLAnchorElement | null;
      if (link?.hasAttribute('href')) {
        link.click();
        showToast('Downloading result...');
      }
    }
  });
}

// === Easter Egg: Console ASCII Logo ===
function showConsoleLogo(): void {
  const logo = `
%c    ☢ NUKEBG ☢
    v1.0.0 — Terminal Edition

    Your images never leave this machine.
    Don't believe us? Read the source:
    https://github.com/yocreoquesi/nukebg

    > ready_
`;
  console.log(logo, 'color: #00ff41; font-family: monospace; font-size: 14px;');
}

// === Easter Egg: Holiday Messages ===
function initHolidayEasterEgg(): void {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-based
  const day = now.getDate();

  let consoleMsg = '';
  let footerMsg = '';

  if (month === 1 && day === 1) {
    consoleMsg = '☢ HAPPY NEW YEAR. Time to nuke some backgrounds. ☢';
    footerMsg = '☢ HAPPY NEW YEAR ☢';
  } else if (month === 2 && day === 14) {
    consoleMsg = '♥ LOVE IS... a clean transparent PNG ♥';
    footerMsg = '♥ LOVE IS... a clean transparent PNG ♥';
  } else if (month === 4 && day === 1) {
    consoleMsg = 'ALL YOUR BACKGROUNDS ARE BELONG TO US';
    footerMsg = 'ALL YOUR BACKGROUNDS ARE BELONG TO US';
  } else if (month === 7 && day === 4) {
    consoleMsg = 'INDEPENDENCE FROM UGLY BACKGROUNDS 🇺🇸';
    footerMsg = 'INDEPENDENCE FROM UGLY BACKGROUNDS';
  } else if (month === 10 && day === 31) {
    const pumpkin = [
      '       ___       ',
      '      /   \\      ',
      '     / o o \\     ',
      '    |   ^   |    ',
      '    |  \\_/  |    ',
      '     \\_____/     ',
    ].join('\n');
    consoleMsg = pumpkin + '\nSPOOKY NUKE MODE ACTIVATED';
    footerMsg = '🎃 SPOOKY NUKE MODE ACTIVATED';
  } else if (month === 12 && day === 25) {
    const tree = [
      '       *        ',
      '      /|\\       ',
      '     /*|*\\      ',
      '    /__|__\\     ',
      '   /***|***\\    ',
      '  /____|____\\   ',
      '      |||       ',
    ].join('\n');
    consoleMsg = tree + '\nMERRY NUKEMAS';
    footerMsg = '🎄 MERRY NUKEMAS';
  }

  if (consoleMsg) {
    console.log(`%c${consoleMsg}`, 'color: #00ff41; font-family: monospace; font-size: 12px;');
  }

  if (footerMsg) {
    const footerEl = document.getElementById('footer-holiday');
    if (footerEl) footerEl.textContent = footerMsg;
  }
}

// === Easter Egg: Konami Code ===
function initKonamiCode(): void {
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let konamiIndex = 0;
  let activated = false;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (activated) return;

    if (e.key === KONAMI[konamiIndex]) {
      konamiIndex++;
      if (konamiIndex === KONAMI.length) {
        konamiIndex = 0;
        activated = true;
        activateUltraNukeMode(prefersReducedMotion);
      }
    } else {
      konamiIndex = e.key === KONAMI[0] ? 1 : 0;
    }
  });
}

function activateUltraNukeMode(reducedMotion: boolean): void {
  console.log('%c⚠ ULTRA NUKE MODE ACTIVATED ⚠', 'color: #ff3131; font-family: monospace; font-size: 18px; font-weight: bold;');

  // Intensify scanlines
  const scanlineStyle = document.createElement('style');
  scanlineStyle.id = 'ultra-nuke-style';
  scanlineStyle.textContent = `
    body::after {
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(255, 49, 49, 0.04) 2px,
        rgba(255, 49, 49, 0.04) 4px
      ) !important;
    }
    :root {
      --color-accent-primary: #ff3131 !important;
      --color-accent-glow: rgba(255, 49, 49, 0.35) !important;
      --color-text-primary: #ff3131 !important;
      --color-text-secondary: #cc2828 !important;
    }
    .logo-accent {
      color: #ff3131 !important;
      text-shadow: 0 0 12px rgba(255, 49, 49, 0.6) !important;
    }
    .logo {
      color: #ff3131 !important;
      text-shadow: 0 0 10px rgba(255, 49, 49, 0.5) !important;
    }
  `;

  // Change hero text
  const arApp = document.querySelector('ar-app');
  const heroH1 = arApp?.shadowRoot?.querySelector('h1');
  let originalH1 = '';
  if (heroH1) {
    originalH1 = heroH1.innerHTML;
    heroH1.innerHTML = `<pre style="font-size: clamp(0.5rem, 2vw, 1rem); line-height: 1.2; margin: 0;">
 ███╗   ██╗██╗   ██╗██╗  ██╗███████╗
 ████╗  ██║██║   ██║██║ ██╔╝██╔════╝
 ██╔██╗ ██║██║   ██║█████╔╝ █████╗
 ██║╚██╗██║██║   ██║██╔═██╗ ██╔══╝
 ██║ ╚████║╚██████╔╝██║  ██╗███████╗
 ╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝</pre>`;
  }

  if (!reducedMotion) {
    document.head.appendChild(scanlineStyle);
  }

  // Show toast
  const toast = document.getElementById('kbd-toast');
  if (toast) {
    toast.textContent = '⚠ ULTRA NUKE MODE ACTIVATED ⚠';
    toast.classList.add('visible');
  }

  // Revert after 5 seconds
  setTimeout(() => {
    const style = document.getElementById('ultra-nuke-style');
    if (style) style.remove();
    if (heroH1 && originalH1) heroH1.innerHTML = originalH1;
    if (toast) {
      toast.textContent = '> normal mode restored_';
      setTimeout(() => toast.classList.remove('visible'), 1500);
    }
  }, 5000);
}

// === Easter Egg: Logo Click Counter ===
function initLogoClickCounter(): void {
  const logo = document.getElementById('logo');
  if (!logo) return;

  let clickCount = 0;
  let clickTimer: ReturnType<typeof setTimeout> | null = null;

  logo.addEventListener('click', (e: MouseEvent) => {
    e.preventDefault();
    clickCount++;

    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { clickCount = 0; }, 2000);

    if (clickCount >= 10) {
      clickCount = 0;
      const toast = document.getElementById('kbd-toast');
      if (toast) {
        toast.textContent = 'Achievement unlocked: COMPULSIVE CLICKER 🏆';
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), 3000);
      }
    }
  });
}

// === i18n: Language Selector + HTML text updates ===
function initI18n(): void {
  const locale = getLocale();

  // Establecer lang del html al inicio
  document.documentElement.lang = locale;

  // Sincronizar el selector
  const langSelector = document.getElementById('lang-selector') as HTMLSelectElement | null;
  if (langSelector) {
    langSelector.value = locale;
    langSelector.addEventListener('change', () => {
      setLocale(langSelector.value);
    });
  }

  // Traducir textos del HTML que no estan en Web Components
  updateHtmlTexts();

  // Re-traducir cuando cambia el idioma
  document.addEventListener('nukebg:locale-changed', () => {
    const sel = document.getElementById('lang-selector') as HTMLSelectElement | null;
    if (sel) sel.value = getLocale();
    updateHtmlTexts();
  });
}

function updateHtmlTexts(): void {
  const skipLink = document.getElementById('skip-link');
  if (skipLink) skipLink.textContent = t('header.skipLink');
  const kofiLink = document.getElementById('kofi-link');
  if (kofiLink) kofiLink.textContent = t('footer.kofi');
  const footerPrivacy = document.getElementById('footer-privacy');
  if (footerPrivacy) footerPrivacy.textContent = t('footer.privacy');
}

// Init on DOMContentLoaded
function init(): void {
  initI18n();
  initKeyboardShortcuts();
  showConsoleLogo();
  initHolidayEasterEgg();
  initKonamiCode();
  initLogoClickCounter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
