/**
 * Sistema i18n lightweight para NukeBG.
 * Auto-detecta idioma del navegador, persiste en localStorage,
 * emite evento custom cuando cambia el locale.
 */

type Translations = Record<string, Record<string, string>>;

const translations: Translations = {
  en: {
    // Hero
    'hero.title.accent': 'Nuke',
    'hero.title.rest': 'Any Background',
    'hero.subtitle': 'Drop any image. Get a clean transparent PNG.\nNo upload. No account. No BS.',
    'hero.modelStatus': 'Ready to nuke',

    // Model / precision
    'model.reprocess': 'Reprocess',

    // Dropzone
    'dropzone.title': 'Drop your image here',
    'dropzone.subtitle': "or click to browse \u2014 we'll nuke the background",
    'dropzone.formats': 'PNG, JPG, WebP up to 4096x4096',
    'dropzone.clipboard': 'Ctrl+V to paste from clipboard',
    'dropzone.dragover': 'Drop to process',
    'dropzone.ariaLabel': 'Upload image for background removal',
    'dropzone.errorFormat': 'Unsupported format. Use PNG, JPG, or WebP.',

    // Progress
    'progress.detectBg': 'Scanning image...',
    'progress.watermarkScan': 'Checking for watermarks',
    'progress.inpaint': 'Removing watermark',
    'progress.bgRemoval': 'Removing background',
    'progress.bgRemovalCV': 'Removing background [CV]',
    'progress.bgRemovalML': 'Removing background [ML]',
    'progress.edgeRefine': 'Refining edges',
    'progress.initAI': 'Initializing AI engine...',
    'progress.total': 'Total:',

    // Download
    'download.btn': '\u2193 Download Clean PNG',
    'download.copy': '\uD83D\uDCCB Copy',
    'download.copied': '\u2713 Copied!',
    'download.copyFailed': 'Copy not supported',
    'download.another': '\u21BB Process another',

    // Editor
    'editor.eraser': 'Eraser:',
    'editor.eraserCircle': 'Circle',
    'editor.eraserSquare': 'Square',
    'editor.eraserSize': 'Size:',
    'editor.undo': 'Undo',
    'editor.redo': 'Redo',
    'editor.zoomFit': 'Fit',
    'editor.cancel': 'Cancel',
    'editor.apply': 'Apply edits',
    'editor.bg': 'BG:',
    'editor.shortcuts': 'Shortcuts',
    'editor.shortcutErase': 'Erase',
    'editor.shortcutEraserSize': 'Eraser size \u00B15',
    'editor.shortcutZoom': 'Zoom',
    'editor.shortcutPan': 'Pan',
    'editor.shortcutResetView': 'Reset view',
    'editor.shortcutUndo': 'Undo',
    'editor.shortcutRedo': 'Redo',

    // Edit button (ar-app)
    'edit.btn': 'Not clean enough? Edit manually',
    'edit.discard': '\u21A9 Discard edits',

    // Viewer
    'viewer.original': 'Before',
    'viewer.result': 'After',
    'viewer.bg': 'BG:',

    // Privacy
    'privacy.badge': '\uD83D\uDD12 100% Client-Side',
    'privacy.tooltip.line1': 'Your images never leave your device.',
    'privacy.tooltip.line2': 'All processing happens in your browser.',
    'privacy.tooltip.line3': 'Verify: check Network tab in DevTools.',

    // Features
    'features.srTitle': 'Background Removal That Actually Works',
    'features.bgRemoval.title': 'No Upload. No Wait.',
    'features.bgRemoval.desc': 'Drop any image and get a transparent PNG in seconds. Photos, illustrations, screenshots, whatever. No watermark, no limits, no account needed.',
    'features.aiArtifacts.title': 'AI Garbage? Gone.',
    'features.aiArtifacts.desc': 'Painted checkerboards, Gemini watermarks... the stuff other tools pretend doesn\u2019t exist. We see it. We nuke it.',
    'features.private.title': 'Open Source. Verify Everything.',
    'features.private.desc': 'Your images never leave your device. Zero uploads, zero tracking, zero artificial slowdowns. No credit system, no paywall. It\u2019s GPL-3.0, go read the code.',
    'features.disclaimer': 'We\u2019re <s>perfect</s> honest. We mess up and we love it.',

    // Header / Footer (index.html)
    'header.skipLink': 'Skip to main content',
    'footer.kofi': '\u2615 Support on Ko-fi',
    'footer.privacy': 'Your images never leave your device. Zero uploads. Zero BS.',

    // Refine edges
    'refine.toggle': 'Refine edges',
    'refine.btn': '\u2622 REFINE EDGES',
    'refine.undo': '\u21A9 UNDO REFINE',

    // Pipeline error
    'pipeline.error': 'Processing failed: {msg}',

    // Language selector
    'lang.label': 'Language',
  },
  es: {
    // Hero
    'hero.title.accent': 'Nukea',
    'hero.title.rest': 'Cualquier Fondo',
    'hero.subtitle': 'Arrastra una imagen. Obt\u00E9n un PNG transparente.\nSin subidas. Sin cuenta. Sin rollos.',
    'hero.modelStatus': 'Listo para nukear',

    // Model / precision
    'model.reprocess': 'Reprocesar',

    // Dropzone
    'dropzone.title': 'Arrastra tu imagen aqu\u00ED',
    'dropzone.subtitle': 'o haz clic para buscar \u2014 nukearemos el fondo',
    'dropzone.formats': 'PNG, JPG, WebP hasta 4096x4096',
    'dropzone.clipboard': 'Ctrl+V para pegar del portapapeles',
    'dropzone.dragover': 'Suelta para procesar',
    'dropzone.ariaLabel': 'Subir imagen para eliminar fondo',
    'dropzone.errorFormat': 'Formato no soportado. Usa PNG, JPG o WebP.',

    // Progress
    'progress.detectBg': 'Analizando imagen...',
    'progress.watermarkScan': 'Buscando marcas de agua',
    'progress.inpaint': 'Eliminando marca de agua',
    'progress.bgRemoval': 'Eliminando fondo',
    'progress.bgRemovalCV': 'Eliminando fondo [CV]',
    'progress.bgRemovalML': 'Eliminando fondo [ML]',
    'progress.edgeRefine': 'Refinando bordes',
    'progress.initAI': 'Inicializando motor IA...',
    'progress.total': 'Total:',

    // Download
    'download.btn': '\u2193 Descargar PNG limpio',
    'download.copy': '\uD83D\uDCCB Copiar',
    'download.copied': '\u2713 \u00A1Copiado!',
    'download.copyFailed': 'Copia no soportada',
    'download.another': '\u21BB Procesar otra',

    // Editor
    'editor.eraser': 'Borrador:',
    'editor.eraserCircle': 'C\u00EDrculo',
    'editor.eraserSquare': 'Cuadrado',
    'editor.eraserSize': 'Tama\u00F1o:',
    'editor.undo': 'Deshacer',
    'editor.redo': 'Rehacer',
    'editor.zoomFit': 'Ajustar',
    'editor.cancel': 'Cancelar',
    'editor.apply': 'Aplicar edici\u00F3n',
    'editor.bg': 'Fondo:',
    'editor.shortcuts': 'Atajos',
    'editor.shortcutErase': 'Borrar',
    'editor.shortcutEraserSize': 'Tama\u00F1o borrador \u00B15',
    'editor.shortcutZoom': 'Zoom',
    'editor.shortcutPan': 'Mover',
    'editor.shortcutResetView': 'Resetear vista',
    'editor.shortcutUndo': 'Deshacer',
    'editor.shortcutRedo': 'Rehacer',

    // Edit button (ar-app)
    'edit.btn': '\u00BFNo qued\u00F3 limpio? Edita manualmente',
    'edit.discard': '\u21A9 Descartar edici\u00F3n',

    // Viewer
    'viewer.original': 'Antes',
    'viewer.result': 'Despu\u00E9s',
    'viewer.bg': 'Fondo:',

    // Privacy
    'privacy.badge': '\uD83D\uDD12 100% en tu navegador',
    'privacy.tooltip.line1': 'Tus im\u00E1genes nunca salen de tu dispositivo.',
    'privacy.tooltip.line2': 'Todo el procesamiento ocurre en tu navegador.',
    'privacy.tooltip.line3': 'Verifica: revisa la pesta\u00F1a Red en DevTools.',

    // Features
    'features.srTitle': 'Eliminaci\u00F3n de fondos que realmente funciona',
    'features.bgRemoval.title': 'Sin subidas. Sin esperas.',
    'features.bgRemoval.desc': 'Arrastra cualquier imagen y obt\u00E9n un PNG transparente en segundos. Fotos, ilustraciones, capturas, lo que sea. Sin marca de agua, sin l\u00EDmites, sin cuenta.',
    'features.aiArtifacts.title': '\u00BFBasura de IA? Eliminada.',
    'features.aiArtifacts.desc': 'Tableros de ajedrez pintados, marcas de agua de Gemini... eso que otras herramientas fingen que no existe. Nosotros lo vemos. Lo eliminamos.',
    'features.private.title': 'C\u00F3digo abierto. Verifica todo.',
    'features.private.desc': 'Tus im\u00E1genes nunca salen de tu dispositivo. Cero subidas, cero rastreo, cero ralentizaciones artificiales. Sin cr\u00E9ditos, sin muro de pago. Es GPL-3.0, lee el c\u00F3digo.',
    'features.disclaimer': 'Somos <s>perfectos</s> honestos. Cometemos errores y nos encanta.',

    // Header / Footer (index.html)
    'header.skipLink': 'Saltar al contenido principal',
    'footer.kofi': '\u2615 Apoyar en Ko-fi',
    'footer.privacy': 'Tus im\u00E1genes nunca salen de tu dispositivo. Cero subidas. Cero rollos.',

    // Refine edges
    'refine.toggle': 'Refinar bordes',
    'refine.btn': '\u2622 REFINAR BORDES',
    'refine.undo': '\u21A9 DESHACER REFINADO',

    // Pipeline error
    'pipeline.error': 'Procesamiento fallido: {msg}',

    // Language selector
    'lang.label': 'Idioma',
  },
};

const STORAGE_KEY = 'nukebg-locale';
const SUPPORTED_LOCALES = Object.keys(translations);
const DEFAULT_LOCALE = 'en';

/** Detecta el idioma del navegador con fallback a 'en' */
function detectLocale(): string {
  // Primero, revisar si hay un parametro ?lang= en la URL
  const urlParams = new URLSearchParams(window.location.search);
  const langParam = urlParams.get('lang');
  if (langParam && SUPPORTED_LOCALES.includes(langParam)) {
    return langParam;
  }

  // Segundo, revisar localStorage
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LOCALES.includes(stored)) {
    return stored;
  }

  // Tercero, detectar del navegador
  const browserLang = navigator.language?.split('-')[0] || DEFAULT_LOCALE;
  if (SUPPORTED_LOCALES.includes(browserLang)) {
    return browserLang;
  }

  return DEFAULT_LOCALE;
}

let currentLocale = detectLocale();

/**
 * Traduce una clave al idioma actual.
 * Soporta interpolacion basica: t('key', { var: 'value' })
 */
export function t(key: string, params?: Record<string, string>): string {
  const value = translations[currentLocale]?.[key]
    ?? translations[DEFAULT_LOCALE]?.[key]
    ?? key;

  if (!params) return value;

  return Object.entries(params).reduce(
    (str, [k, v]) => str.replace(`{${k}}`, v),
    value,
  );
}

/** Cambia el idioma activo */
export function setLocale(locale: string): void {
  if (!SUPPORTED_LOCALES.includes(locale)) return;
  if (locale === currentLocale) return;

  currentLocale = locale;
  localStorage.setItem(STORAGE_KEY, locale);

  // Actualizar lang del html
  document.documentElement.lang = locale;

  // Emitir evento para que los componentes se re-rendericen
  document.dispatchEvent(new CustomEvent('nukebg:locale-changed', {
    detail: { locale },
  }));
}

/** Obtiene el idioma activo */
export function getLocale(): string {
  return currentLocale;
}

/** Obtiene la lista de idiomas soportados */
export function getSupportedLocales(): string[] {
  return [...SUPPORTED_LOCALES];
}
