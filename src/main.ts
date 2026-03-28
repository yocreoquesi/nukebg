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
    v2.3.0 — Terminal Edition

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

  // Show toast (dismissable on click)
  const toast = document.getElementById('kbd-toast');
  if (toast) {
    toast.textContent = '⚠ ULTRA NUKE MODE ACTIVATED ⚠ (click to dismiss)';
    toast.classList.add('visible');
    toast.style.cursor = 'pointer';
  }

  const dismiss = (): void => {
    const style = document.getElementById('ultra-nuke-style');
    if (style) style.remove();
    if (heroH1 && originalH1) heroH1.innerHTML = originalH1;
    if (toast) {
      toast.textContent = '> normal mode restored_';
      toast.style.cursor = '';
      toast.removeEventListener('click', dismiss);
      setTimeout(() => toast.classList.remove('visible'), 1500);
    }
  };

  if (toast) toast.addEventListener('click', dismiss);

  // Auto-revert after 10 seconds
  setTimeout(dismiss, 10000);
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
        toast.textContent = 'Achievement unlocked: COMPULSIVE CLICKER (click to dismiss)';
        toast.classList.add('visible');
        toast.style.cursor = 'pointer';
        const dismissClick = (): void => {
          toast.classList.remove('visible');
          toast.style.cursor = '';
          toast.removeEventListener('click', dismissClick);
        };
        toast.addEventListener('click', dismissClick);
        setTimeout(dismissClick, 8000);
      }
    }
  });
}

// === Easter Egg: Double-tap logo whisper ===
function initLogoDoubleTap(): void {
  const logo = document.getElementById('logo');
  const whisper = document.getElementById('logo-whisper');
  if (!logo || !whisper) return;

  const messagesEN = [
    'You called?', 'Still here. Still nuking.', 'That tickles.',
    'Stop poking me.', "I'm working, I'm working...", 'Beep boop. Nuke ready.',
    'Yes, I\'m open source. Yes, really.', 'Your backgrounds fear me.',
    'Fun fact: your image never left this device.', 'Powered by radiation and good vibes.',
  ];
  const messagesES = [
    '\u00BFMe llamaste?', 'Sigo aqu\u00ED. Sigo nukeando.', 'Eso hace cosquillas.',
    'Deja de tocarme.', 'Estoy trabajando, estoy trabajando...', 'Beep boop. Nuke listo.',
    'S\u00ED, soy open source. S\u00ED, de verdad.', 'Tus fondos me temen.',
    'Dato curioso: tu imagen nunca sali\u00F3 de este dispositivo.', 'Impulsado por radiaci\u00F3n y buenas vibras.',
  ];

  let lastTap = 0;
  let whisperTimer: ReturnType<typeof setTimeout> | null = null;

  logo.addEventListener('touchend', (e: TouchEvent) => {
    const now = Date.now();
    if (now - lastTap < 400) {
      e.preventDefault();
      const msgs = document.documentElement.lang === 'es' ? messagesES : messagesEN;
      whisper.textContent = msgs[Math.floor(Math.random() * msgs.length)];
      whisper.classList.add('visible');
      if (whisperTimer) clearTimeout(whisperTimer);
      whisperTimer = setTimeout(() => whisper.classList.remove('visible'), 2000);
    }
    lastTap = now;
  });

  // Also support double-click on desktop
  logo.addEventListener('dblclick', (e: MouseEvent) => {
    e.preventDefault();
    const msgs = document.documentElement.lang === 'es' ? messagesES : messagesEN;
    whisper.textContent = msgs[Math.floor(Math.random() * msgs.length)];
    whisper.classList.add('visible');
    if (whisperTimer) clearTimeout(whisperTimer);
    whisperTimer = setTimeout(() => whisper.classList.remove('visible'), 2000);
  });
}

// === Easter Egg: Shake to nuke (mobile) ===
function initShakeDetection(): void {
  if (typeof DeviceMotionEvent === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let lastShake = 0;
  let shakeCount = 0;
  let shakeTimer: ReturnType<typeof setTimeout> | null = null;

  window.addEventListener('devicemotion', (e: DeviceMotionEvent) => {
    const acc = e.accelerationIncludingGravity;
    if (!acc) return;
    const force = Math.abs(acc.x || 0) + Math.abs(acc.y || 0) + Math.abs(acc.z || 0);

    if (force > 30) {
      const now = Date.now();
      if (now - lastShake > 300) {
        shakeCount++;
        lastShake = now;

        if (shakeTimer) clearTimeout(shakeTimer);
        shakeTimer = setTimeout(() => { shakeCount = 0; }, 1500);

        if (shakeCount >= 3) {
          shakeCount = 0;
          const toast = document.getElementById('kbd-toast');
          if (toast) {
            const msg = document.documentElement.lang === 'es'
              ? '> SACUDIDA DETECTADA. Nukeando m\u00E1s fuerte.'
              : '> SHAKE DETECTED. Nuking harder.';
            toast.textContent = msg;
            toast.classList.add('visible');
            setTimeout(() => toast.classList.remove('visible'), 2500);
          }
        }
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

// === Terminal Prompt Easter Egg ===
/** Clear all caches, unregister service workers, and reload */
function nukeCache(): void {
  // Only clear ML model caches, not the app shell
  // This prevents the blank page bug in Brave and other strict browsers
  Promise.all([
    caches.keys().then(keys => {
      const modelCaches = keys.filter(k => k.includes('transformers') || k.includes('onnx') || k.includes('model'));
      return Promise.all(modelCaches.map(k => caches.delete(k)));
    }),
  ]).then(() => {
    // Use cache-busting URL param to force fresh load
    const url = new URL(window.location.href);
    url.searchParams.set('_cb', Date.now().toString());
    window.location.href = url.toString();
  }).catch(() => {
    window.location.reload();
  });
}

/** Footer clear cache button */
function initClearCacheButton(): void {
  const btn = document.getElementById('clear-cache-btn');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    btn.textContent = '☢ Purging...';
    setTimeout(() => nukeCache(), 500);
  });
}

function initTerminalPrompt(): void {
  const input = document.getElementById('terminal-input') as HTMLInputElement | null;
  const cursor = document.getElementById('terminal-cursor');
  const promptContainer = document.getElementById('terminal-prompt');
  if (!input || !cursor || !promptContainer) return;

  let isShowingResponse = false;

  const COMMANDS: Record<string, string> = {
    // sudo combos
    'sudo': '> sudo what? Try \'sudo nuke\' or \'sudo help\'',
    'sudo nuke': '> LAUNCHING ALL NUKES...',
    'sudo rm': '> rm: cannot remove \'backgrounds\': already nuked',
    'sudo rm -rf': '> rm -rf /backgrounds/* — 100% nuked. You monster.',
    'sudo help': '> man nukebg: Drop. Nuke. Download. EOF.',
    'sudo sudo': '> inception mode denied. One sudo is enough.',
    'sudo exit': '> nice try. There is no escape.',
    'sudo hack': '> You\'re already root. What more do you want?',
    'sudo ls': '> drwxr-xr-x your_images/ (local only, we can\'t see them)',
    'sudo clear': '> Purging cache...',
    'sudo cat': '> sudo: 🐱: permission denied. Cats obey no one.',
    'sudo vim': '> Opened vim. Good luck getting out.',
    // basic commands
    'nuke': '> Nuke what? Drop an image first.',
    'exit': '> There is no escape from NukeBG.',
    'ls': '> backgrounds/ watermarks/ — scheduled for deletion',
    'rm -rf': '> whoa whoa whoa. Not that kind of terminal.',
    'hack': '> You\'re already in. What more do you want?',
    'hello': '> Hello, operator. Ready to nuke?',
    'hi': '> Hello, operator. Ready to nuke?',
    'clear': '> Purging cache...',
    'purge': '> Purging cache...',
    'whoami': '> You\'re the one nuking backgrounds. That\'s who.',
    'pwd': '> /home/user/images/about-to-be-nuked/',
    'cat': '> 🐱 meow. Wrong terminal.',
    'ping': '> pong. But we don\'t do network stuff here.',
    'cd': '> You\'re already where you need to be.',
    'vim': '> How do I exit this? Just kidding. Try \'nuke\'.',
    'man': '> NUKEBG(1) — Drop image, nuke background, download PNG. The end.',
    'echo': '> echo echo echo... is there an echo in here?',
    'top': '> PID 1: nukebg — CPU: yes. RAM: some. Status: nuking.',
    'git': '> git commit -m "nuked another background"',
    'npm': '> npm run nuke — 1 background destroyed, 0 uploaded.',
  };

  // Rotating help groups — sudo always first, then 4-5 random commands
  const HELP_POOLS = [
    ['sudo', 'nuke', 'ls', 'hack', 'exit'],
    ['sudo', 'whoami', 'cat', 'vim', 'pwd'],
    ['sudo', 'ping', 'cd', 'clear', 'man'],
    ['sudo', 'echo', 'top', 'git', 'npm'],
    ['sudo', 'rm -rf', 'hello', 'purge', 'hack'],
  ];
  let helpIndex = 0;

  function getHelpResponse(): string {
    const group = HELP_POOLS[helpIndex % HELP_POOLS.length];
    helpIndex++;
    return `> Commands: ${group.join(', ')}`;
  }

  function showResponse(text: string, isError: boolean = false, keepFocus: boolean = true, durationMs?: number): void {
    isShowingResponse = true;
    input!.style.display = 'none';
    cursor!.style.display = 'none';

    const response = document.createElement('span');
    response.className = 'terminal-response' + (isError ? ' error' : '');
    response.textContent = text;
    promptContainer!.appendChild(response);

    const duration = durationMs ?? (isError ? 1500 : 2000);
    setTimeout(() => {
      response.remove();
      input!.style.display = '';
      input!.value = '';
      cursor!.style.display = '';
      cursor!.classList.add('hidden');
      isShowingResponse = false;
      if (keepFocus) input!.focus();
    }, duration);
  }

  // Click on cursor or prompt area focuses input
  cursor.addEventListener('click', () => input.focus());
  promptContainer.addEventListener('click', () => input.focus());

  // Hide blinking cursor on focus, show on blur when empty
  input.addEventListener('focus', () => {
    cursor.classList.add('hidden');
  });
  input.addEventListener('blur', () => {
    if (input.value.length === 0 && !isShowingResponse) {
      cursor.classList.remove('hidden');
    }
  });
  input.addEventListener('input', () => {
    cursor.classList.add('hidden');

    // Buffer overflow: char 11 triggers error
    if (input.value.length >= 11) {
      showResponse('> ERROR: Buffer overflow', true);
    }
  });

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || isShowingResponse) return;
    e.preventDefault();

    const cmd = input.value.trim().toLowerCase();
    if (!cmd) return;

    // Special case: sudo nuke triggers vibrate
    if (cmd === 'sudo nuke') {
      const arApp = document.querySelector('ar-app');
      if (arApp) {
        arApp.classList.add('nuke-vibrate');
        setTimeout(() => arApp.classList.remove('nuke-vibrate'), 1000);
      }
    }

    // Special case: clear/purge/sudo clear — clears cache
    if (cmd === 'clear' || cmd === 'purge' || cmd === 'sudo clear') {
      showResponse(COMMANDS[cmd] || '> Purging cache...', false, false);
      setTimeout(() => nukeCache(), 1500);
      return;
    }

    // Special case: help help — show all commands via toast (doesn't displace elements)
    if (cmd === 'help help') {
      showResponse('> Fine, showing all commands...', false, true, 1500);
      const toast = document.getElementById('kbd-toast');
      if (toast) {
        toast.textContent = 'sudo | nuke | ls | exit | clear | hack | whoami | pwd | cat | ping | cd | vim | man | echo | top | git | npm | help';
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), 6000);
      }
      return;
    }

    // Special case: help — rotating command groups
    if (cmd === 'help') {
      showResponse(getHelpResponse());
      return;
    }

    const response = COMMANDS[cmd] || `> Command not found: ${input.value.trim()}. Try 'help'`;
    showResponse(response);
  });

  // Subtle hint: show "help" placeholder briefly on load
  input.placeholder = 'help';
  input.style.setProperty('--placeholder-opacity', '1');
  setTimeout(() => {
    input.placeholder = '';
  }, 3000);
}

// === Share Button ===
function initShareButton(): void {
  const btn = document.getElementById('share-btn');
  if (!btn) return;

  const messagesEN = [
    'Just nuked a background in 3 seconds. No upload, no account, no BS \u2192 https://nukebg.app',
    'Found a background remover that actually respects your privacy \u2192 https://nukebg.app',
    'Drop. Nuke. Download. That\'s it. \u2192 https://nukebg.app',
    'My backgrounds didn\'t stand a chance \u2192 https://nukebg.app',
    'Open source background remover that runs in your browser \u2192 https://nukebg.app',
    'Zero uploads, zero tracking, zero BS. Just clean PNGs \u2192 https://nukebg.app',
    'https://nukebg.app \u2014 because your pixels deserve freedom',
    'Other tools upload your images. This one doesn\'t even know you exist \u2192 https://nukebg.app',
  ];

  const messagesES = [
    'Acabo de nukear un fondo en 3 segundos. Sin subidas, sin cuenta, sin rollos \u2192 https://nukebg.app',
    'Un eliminador de fondos que respeta tu privacidad de verdad \u2192 https://nukebg.app',
    'Arrastra. Nukea. Descarga. Fin. \u2192 https://nukebg.app',
    'Mis fondos no tuvieron oportunidad \u2192 https://nukebg.app',
    'Eliminador de fondos open source que corre en tu navegador \u2192 https://nukebg.app',
    'Cero subidas, cero rastreo, cero rollos. Solo PNGs limpios \u2192 https://nukebg.app',
    'https://nukebg.app \u2014 porque tus p\u00EDxeles merecen libertad',
    'Otras herramientas suben tus im\u00E1genes. Esta ni sabe que existes \u2192 https://nukebg.app',
  ];

  const messages = document.documentElement.lang === 'es' ? messagesES : messagesEN;

  btn.addEventListener('click', async () => {
    const msg = messages[Math.floor(Math.random() * messages.length)];
    try {
      await navigator.clipboard.writeText(msg);
      const toast = document.getElementById('kbd-toast');
      if (toast) {
        toast.textContent = document.documentElement.lang === 'es' ? '> Copiado! P\u00E9galo donde quieras.' : '> Copied! Paste it anywhere.';
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), 2000);
      }
    } catch {
      // Fallback: use textarea trick
      const ta = document.createElement('textarea');
      ta.value = msg;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      const toast = document.getElementById('kbd-toast');
      if (toast) {
        toast.textContent = '> Copied! Paste it anywhere.';
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), 2000);
      }
    }
  });
}

// Init on DOMContentLoaded
function init(): void {
  initI18n();
  initKeyboardShortcuts();
  initTerminalPrompt();
  initClearCacheButton();
  initShareButton();
  showConsoleLogo();
  initHolidayEasterEgg();
  initKonamiCode();
  initLogoClickCounter();
  initLogoDoubleTap();
  initShakeDetection();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
