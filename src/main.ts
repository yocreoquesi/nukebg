// Remove static SEO content before app hydrates
document.getElementById('seo-content')?.remove();

// Import styles
import './styles/main.css';

// i18n - importar antes de los componentes para que detecte el locale
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
    v2.5.0 | Terminal Edition

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

  const whisperMessages: Record<string, string[]> = {
    en: [
      'You called?', 'Still here. Still nuking.', 'That tickles.',
      'Stop poking me.', "I'm working, I'm working...", 'Beep boop. Nuke ready.',
      'Yes, I\'m open source. Yes, really.', 'Your backgrounds fear me.',
      'Fun fact: your image never left this device.', 'Powered by radiation and good vibes.',
    ],
    es: [
      '\u00BFMe llamaste?', 'Sigo aqu\u00ED. Sigo nukeando.', 'Eso hace cosquillas.',
      'Deja de tocarme.', 'Estoy trabajando, estoy trabajando...', 'Beep boop. Nuke listo.',
      'S\u00ED, soy open source. S\u00ED, de verdad.', 'Tus fondos me temen.',
      'Dato curioso: tu imagen nunca sali\u00F3 de este dispositivo.', 'Impulsado por radiaci\u00F3n y buenas vibras.',
    ],
    fr: [
      'Tu m\'as appel\u00E9?', 'Toujours l\u00E0. Toujours en train d\'atomiser.', '\u00C7a chatouille.',
      'Arr\u00EAte de me toucher.', 'Je bosse, je bosse...', 'Bip boup. Nuke pr\u00EAt.',
      'Oui, je suis open source. Oui, pour de vrai.', 'Tes fonds me craignent.',
      'Fun fact: ton image n\'a jamais quitt\u00E9 cet appareil.', 'Aliment\u00E9 par la radiation et la bonne humeur.',
    ],
    de: [
      'Gerufen?', 'Immer noch da. Immer noch am Nuken.', 'Das kitzelt.',
      'H\u00F6r auf mich anzustupsen.', 'Ich arbeite, ich arbeite...', 'Piep piep. Nuke bereit.',
      'Ja, ich bin Open Source. Ja, wirklich.', 'Deine Hintergr\u00FCnde f\u00FCrchten mich.',
      'Fun Fact: Dein Bild hat dieses Ger\u00E4t nie verlassen.', 'Betrieben mit Strahlung und guter Laune.',
    ],
    pt: [
      'Me chamou?', 'Ainda aqui. Ainda nukeando.', 'Isso faz c\u00F3cegas.',
      'Para de me cutucar.', 'To trabalhando, to trabalhando...', 'Bip bop. Nuke pronto.',
      'Sim, sou open source. Sim, de verdade.', 'Seus fundos me temem.',
      'Curiosidade: sua imagem nunca saiu deste dispositivo.', 'Movido a radia\u00E7\u00E3o e boas vibras.',
    ],
    zh: [
      '\u4F60\u53EB\u6211\uFF1F', '\u8FD8\u5728\u3002\u8FD8\u5728\u6838\u7206\u3002', '\u597D\u75D2\u3002',
      '\u522B\u6233\u6211\u4E86\u3002', '\u5728\u5E72\u6D3B\u5462\uFF0C\u5728\u5E72\u6D3B\u5462...', '\u6EF4\u6EF4\u3002\u6838\u5F39\u5C31\u7EEA\u3002',
      '\u5BF9\uFF0C\u6211\u662F\u5F00\u6E90\u7684\u3002\u5BF9\uFF0C\u771F\u7684\u3002', '\u4F60\u7684\u80CC\u666F\u6015\u6211\u3002',
      '\u51B7\u77E5\u8BC6\uFF1A\u4F60\u7684\u56FE\u7247\u4ECE\u672A\u79BB\u5F00\u8FC7\u8FD9\u53F0\u8BBE\u5907\u3002', '\u9760\u8F90\u5C04\u548C\u597D\u5FC3\u60C5\u9A71\u52A8\u3002',
    ],
  };

  let lastTap = 0;
  let whisperTimer: ReturnType<typeof setTimeout> | null = null;

  const showWhisper = (): void => {
    const lang = document.documentElement.lang || 'en';
    const msgs = whisperMessages[lang] || whisperMessages['en'];
    whisper.textContent = msgs[Math.floor(Math.random() * msgs.length)];
    whisper.classList.add('visible');
    if (whisperTimer) clearTimeout(whisperTimer);
    whisperTimer = setTimeout(() => whisper.classList.remove('visible'), 2000);
  };

  logo.addEventListener('touchend', (e: TouchEvent) => {
    const now = Date.now();
    if (now - lastTap < 400) {
      e.preventDefault();
      showWhisper();
    }
    lastTap = now;
  });

  // Also support double-click on desktop
  logo.addEventListener('dblclick', (e: MouseEvent) => {
    e.preventDefault();
    showWhisper();
  });
}

// === Easter Egg: Shake to nuke (mobile) ===
function initShakeDetection(): void {
  if (typeof DeviceMotionEvent === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const shakeMessages: Record<string, string[]> = {
    en: [
      '> Not safe to shake radioactive material.',
      '> SHAKE DETECTED. Nuking harder.',
      '> Careful. This thing is nuclear.',
      '> The reactor is unstable enough already.',
      '> You break it, you buy it. Wait, it\'s free.',
      '> Shaking won\'t fix your background. Dropping the image will.',
    ],
    es: [
      '> No es seguro agitar material radiactivo.',
      '> SACUDIDA DETECTADA. Nukeando con m\u00E1s fuerza.',
      '> Cuidado. Esto es nuclear.',
      '> El reactor ya es bastante inestable.',
      '> Si lo rompes, lo pagas. Espera, es gratis.',
      '> Agitar no arregla tu fondo. Soltar la imagen s\u00ED.',
    ],
    fr: [
      '> Pas prudent de secouer du mat\u00E9riel radioactif.',
      '> SECOUSSE D\u00C9TECT\u00C9E. Atomisation renforc\u00E9e.',
      '> Doucement. C\'est nucl\u00E9aire.',
      '> Le r\u00E9acteur est d\u00E9j\u00E0 assez instable.',
      '> Tu casses, tu paies. Ah non, c\'est gratuit.',
      '> Secouer ne r\u00E9pare pas ton fond. D\u00E9pose l\'image plut\u00F4t.',
    ],
    de: [
      '> Radioaktives Material sch\u00FCtteln: keine gute Idee.',
      '> ERSCH\u00DCTTERUNG ERKANNT. Nuke-Intensit\u00E4t erh\u00F6ht.',
      '> Vorsicht. Das Ding ist nuklear.',
      '> Der Reaktor ist schon instabil genug.',
      '> Kaputt? Musst du zahlen. Ach ne, ist gratis.',
      '> Sch\u00FCtteln repariert deinen Hintergrund nicht. Bild reinwerfen schon.',
    ],
    pt: [
      '> N\u00E3o \u00E9 seguro sacudir material radioativo.',
      '> TREMOR DETECTADO. Nukeando mais forte.',
      '> Cuidado. Isso aqui \u00E9 nuclear.',
      '> O reator j\u00E1 \u00E9 inst\u00E1vel o suficiente.',
      '> Quebrou, paga. P\u00E9ra, \u00E9 de gra\u00E7a.',
      '> Sacudir n\u00E3o arruma o fundo. Soltar a imagem sim.',
    ],
    zh: [
      '> \u6447\u6643\u653E\u5C04\u6027\u7269\u8D28\u4E0D\u5B89\u5168\u3002',
      '> \u68C0\u6D4B\u5230\u6447\u6643\u3002\u6838\u7206\u529B\u5EA6\u52A0\u5927\u3002',
      '> \u5C0F\u5FC3\u3002\u8FD9\u4E1C\u897F\u662F\u6838\u52A8\u529B\u7684\u3002',
      '> \u53CD\u5E94\u5806\u5DF2\u7ECF\u591F\u4E0D\u7A33\u5B9A\u4E86\u3002',
      '> \u6447\u574F\u4E86\u4F60\u8D54\u3002\u7B49\u7B49\uFF0C\u8FD9\u662F\u514D\u8D39\u7684\u3002',
      '> \u6447\u6643\u4FEE\u4E0D\u597D\u80CC\u666F\u3002\u4E22\u56FE\u7247\u8FDB\u6765\u624D\u884C\u3002',
    ],
  };

  let shakeIndex = 0;
  let lastShake = 0;
  let shakeCount = 0;
  let shakeTimer: ReturnType<typeof setTimeout> | null = null;

  function startListening(): void {
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
              const lang = document.documentElement.lang || 'en';
              const msgs = shakeMessages[lang] || shakeMessages['en'];
              toast.textContent = msgs[shakeIndex % msgs.length];
              shakeIndex++;
              toast.classList.add('visible');
              setTimeout(() => toast.classList.remove('visible'), 2500);
            }
          }
        }
      }
    });
  }

  // Firefox/Safari mobile require explicit permission for DeviceMotionEvent
  const dme = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof dme.requestPermission === 'function') {
    // Request on first user interaction (touch)
    const requestOnce = (): void => {
      dme.requestPermission!().then((state: string) => {
        if (state === 'granted') startListening();
      }).catch(() => { /* permission denied, silent */ });
      document.removeEventListener('touchstart', requestOnce);
    };
    document.addEventListener('touchstart', requestOnce, { once: true });
  } else {
    startListening();
  }
}

// === i18n: Language Selector + HTML text updates ===
function initI18n(): void {
  const locale = getLocale();

  // Set html lang attribute on init
  document.documentElement.lang = locale;

  // Sync the selector
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
    'sudo rm -rf': '> rm -rf /backgrounds/* | 100% nuked. You monster.',
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
    'ls': '> backgrounds/ watermarks/ [scheduled for deletion]',
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
    'man': '> NUKEBG(1) Drop image, nuke background, download PNG. The end.',
    'echo': '> echo echo echo... is there an echo in here?',
    'top': '> PID 1: nukebg | CPU: yes. RAM: some. Status: nuking.',
    'git': '> git commit -m "nuked another background"',
    'npm': '> npm run nuke | 1 background destroyed, 0 uploaded.',
  };

  // Rotating help groups - sudo always first, then 4-5 random commands
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

    // Special case: clear/purge/sudo clear - clears cache
    if (cmd === 'clear' || cmd === 'purge' || cmd === 'sudo clear') {
      showResponse(COMMANDS[cmd] || '> Purging cache...', false, false);
      setTimeout(() => nukeCache(), 1500);
      return;
    }

    // Special case: help help - show all commands via toast (doesn't displace elements)
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

    // Special case: help - rotating command groups
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

  const shareMessages: Record<string, string[]> = {
    en: [
      'Other tools upload your images. This one doesn\'t even know you exist \u2192 https://nukebg.app',
      'Found a background remover that never uploads your images \u2192 https://nukebg.app',
      'Drop. Nuke. Download. Your images never leave your device \u2192 https://nukebg.app',
      'Zero uploads, zero tracking, zero BS. Just clean PNGs \u2192 https://nukebg.app',
      'Open source background remover that runs 100% in your browser \u2192 https://nukebg.app',
      'https://nukebg.app | because uploading images to remove a background is insane',
    ],
    es: [
      'Otras herramientas suben tus im\u00E1genes. Esta ni sabe que existes \u2192 https://nukebg.app',
      'Un eliminador de fondos que nunca sube tus im\u00E1genes \u2192 https://nukebg.app',
      'Arrastra. Nukea. Descarga. Tus im\u00E1genes nunca salen de tu dispositivo \u2192 https://nukebg.app',
      'Cero subidas, cero rastreo, cero rollos. Solo PNGs limpios \u2192 https://nukebg.app',
      'Eliminador de fondos open source que corre 100% en tu navegador \u2192 https://nukebg.app',
      'https://nukebg.app | porque subir tus im\u00E1genes para quitarles el fondo no tiene sentido',
    ],
    fr: [
      'Les autres outils uploadent tes images. Celui-ci ne sait m\u00EAme pas que tu existes \u2192 https://nukebg.app',
      'Un d\u00E9toureur qui n\'uploade jamais tes images \u2192 https://nukebg.app',
      'D\u00E9pose. Atomise. T\u00E9l\u00E9charge. Tes images ne quittent jamais ton appareil \u2192 https://nukebg.app',
      'Z\u00E9ro upload, z\u00E9ro tracking, z\u00E9ro baratin \u2192 https://nukebg.app',
      'https://nukebg.app | parce qu\'uploader ses images pour retirer un fond, c\'est absurde',
    ],
    de: [
      'Andere Tools laden deine Bilder hoch. Dieses kennt dich nichtmal \u2192 https://nukebg.app',
      'Hintergrund-Entferner, der deine Bilder nie hochl\u00E4dt \u2192 https://nukebg.app',
      'Reinwerfen. Nuken. Runterladen. Deine Bilder verlassen nie dein Ger\u00E4t \u2192 https://nukebg.app',
      'Null Uploads, null Tracking, null Bullshit \u2192 https://nukebg.app',
      'https://nukebg.app | weil Bilder hochladen um den Hintergrund zu entfernen Irrsinn ist',
    ],
    pt: [
      'Outras ferramentas sobem suas imagens. Essa nem sabe que voc\u00EA existe \u2192 https://nukebg.app',
      'Removedor de fundo que nunca sobe suas imagens \u2192 https://nukebg.app',
      'Joga. Nukeia. Baixa. Suas imagens nunca saem do seu dispositivo \u2192 https://nukebg.app',
      'Zero uploads, zero rastreamento, zero frescura \u2192 https://nukebg.app',
      'https://nukebg.app | porque subir imagem pra tirar fundo n\u00E3o faz sentido',
    ],
    zh: [
      '\u5176\u4ED6\u5DE5\u5177\u4F1A\u4E0A\u4F20\u4F60\u7684\u56FE\u7247\u3002\u8FD9\u4E2A\u8FDE\u4F60\u662F\u8C01\u90FD\u4E0D\u77E5\u9053 \u2192 https://nukebg.app',
      '\u627E\u5230\u4E00\u4E2A\u6C38\u8FDC\u4E0D\u4F1A\u4E0A\u4F20\u4F60\u56FE\u7247\u7684\u53BB\u80CC\u666F\u5DE5\u5177 \u2192 https://nukebg.app',
      '\u4E22\u56FE\u3002\u6838\u7206\u3002\u4E0B\u8F7D\u3002\u4F60\u7684\u56FE\u7247\u6C38\u8FDC\u4E0D\u4F1A\u79BB\u5F00\u4F60\u7684\u8BBE\u5907 \u2192 https://nukebg.app',
      '\u96F6\u4E0A\u4F20\uFF0C\u96F6\u8FFD\u8E2A\uFF0C\u96F6\u5E9F\u8BDD \u2192 https://nukebg.app',
      'https://nukebg.app | \u56E0\u4E3A\u4E3A\u4E86\u53BB\u80CC\u666F\u800C\u4E0A\u4F20\u56FE\u7247\u592A\u79BB\u8C31\u4E86',
    ],
  };

  const lang = document.documentElement.lang || 'en';
  const messages = shareMessages[lang] || shareMessages['en'];

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
