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

    // Dropzone
    'dropzone.title': 'Drop your image here',
    'dropzone.subtitle': "or click to browse. We'll nuke the background",
    'dropzone.formats': 'PNG, JPG, WebP up to 100 MP / 80 MB',
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
    'progress.initAI': 'Initializing AI engine...',
    'progress.total': 'Total:',
    'progress.downscaled': 'Large image: processing at {w}\u00D7{h} to fit memory (output at original {ow}\u00D7{oh}).',

    // Download
    'download.btn': '\u2193 Download Clean PNG',
    'download.btnWebp': '\u2193 Download Clean WebP',
    'download.formatPng': 'PNG',
    'download.formatWebp': 'WebP',
    'download.copy': '\uD83D\uDCCB Copy',
    'download.copied': '\u2713 Copied!',
    'download.copyFailed': 'Copy not supported',
    'download.another': '\u21BB Process another',

    // Editor
    'editor.tool': 'Tool:',
    'editor.shape': 'Shape:',
    'editor.eraser': 'Eraser',
    'editor.restore': 'Restore',
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
    'advanced.cta': 'Not satisfied with the result? Try our advanced editor',
    'advanced.title': '[LAB] Advanced editor',
    'advanced.toggleBefore': 'Before',
    'advanced.toggleAfter': 'After',
    'advanced.apply': 'Apply',
    'advanced.cancel': 'Cancel',
    'advanced.toolBrush': 'Brush',
    'advanced.toolEraser': 'Eraser',
    'advanced.size': 'Size',
    'advanced.hint': 'Brush restores from original. Eraser removes pixels.',
    'advanced.toolLasso': 'Lasso',
    'advanced.hintLasso': 'Draw a freehand loop. Drag handles to adjust. Double-click a handle to remove it.',
    'advanced.actionCrop': 'Crop',
    'advanced.actionRefine': 'Re-detect',
    'advanced.actionEraseArea': 'Erase area',
    'advanced.working': 'Processing…',
    'advanced.refineError': 'Re-detect failed',
    'advanced.undo': 'Undo',
    'advanced.redo': 'Redo',
    'advanced.zoom': 'Zoom',
    'advanced.zoomIn': 'Zoom in',
    'advanced.zoomOut': 'Zoom out',
    'advanced.zoomFit': 'Fit to view',

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
    'features.srTitle': 'Background Removal That Never Uploads Your Images',
    'features.bgRemoval.title': 'Your Images Never Leave.',
    'features.bgRemoval.desc': 'Zero uploads. Zero tracking. The ML model runs in your browser via WebAssembly. Don\'t trust us. Open DevTools and check the Network tab.',
    'features.aiArtifacts.title': 'It Knows What You Dropped.',
    'features.aiArtifacts.desc': 'Photo, illustration, signature, icon. We classify it and pick the right algorithm. Not one model blindly applied to everything.',
    'features.private.title': 'No Account. No Paywall. No Catch.',
    'features.private.desc': 'Unlimited uses, no watermarks on output, no credit system. GPL-3.0. Go read the code.',
    'features.disclaimer': 'We\'re <s>perfect</s> honest. Sometimes we miss. Fix it with the editor or <a href="https://github.com/yocreoquesi/nukebg/issues" target="_blank" rel="noopener">yell at the repo</a>.',
    'features.limitations': '\u2192 <strong>Works best with:</strong> clear subjects on contrasting backgrounds, photos, logos, signatures.<br>\u2192 <strong>May struggle with:</strong> hair on busy backgrounds, semi-transparent objects, very complex poses.<br>\u2192 <strong>Tip:</strong> use the manual editor to fix any rough spots. The eraser gives you pixel-level control.',

    // Header / Footer (index.html)
    'header.skipLink': 'Skip to main content',
    'footer.kofi': '\u2615 Support on Ko-fi',
    'footer.privacy': 'Your images never leave your device. Zero uploads. Zero BS.',

    // Pipeline error
    'pipeline.error': 'Processing failed: {msg}',

    // PWA
    'pwa.install': '[INSTALL] Run locally',
    'pwa.installed': 'Running locally',
    'pwa.guideMotivation': '\u2622 Go offline. Run the reactor from your device.',
    'pwa.guideFirefox': '1. Tap \u22EF (three dots, bottom bar)<br>2. Tap "\u2026 More"<br>3. Tap "Add app to Home screen"',
    'pwa.guideSafari': '1. Tap the Share button (\u2B06) at the bottom bar<br>2. Scroll down \u2192 tap "Add to Home Screen"',
    'pwa.guideGeneric': '1. Open your browser menu (\u22EE or \u22EF)<br>2. Look for "Install" or "Add to Home Screen"',
    'pwa.guideDismiss': '[ROGER]',

    // Batch mode
    'batch.processing': 'Processing {current}/{total}',
    'batch.downloadZip': '\u2193 Download all as ZIP',
    'batch.failed': 'Failed',
    'batch.retry': 'Retry',
    'batch.discard': 'Discard',
    'batch.backToGrid': '\u2190 Back to grid',
    'batch.limitExceeded': 'Max {limit} images at once. Taking the first {limit}.',
    'batch.pending': 'Queued',
    'batch.processingState': 'Processing...',
    'batch.done': 'Done',
    'batch.discarded': 'Discarded',
    'batch.completed': '{done}/{total} ready, {failed} failed',
    'batch.emptyZip': 'No completed images to download',
    'batch.cancel': 'Cancel batch',
    'dropzone.multi': 'Drop up to 12 images for batch mode',

    // Language selector
    'lang.label': 'Language',
  },
  es: {
    // Hero
    'hero.title.accent': 'Nukea',
    'hero.title.rest': 'Cualquier Fondo',
    'hero.subtitle': 'Arrastra una imagen. Obt\u00E9n un PNG transparente.\nSin subidas. Sin cuenta. Sin rollos.',
    'hero.modelStatus': 'Listo para nukear',

    // Dropzone
    'dropzone.title': 'Arrastra tu imagen aqu\u00ED',
    'dropzone.subtitle': 'o haz clic para buscar. Nukearemos el fondo',
    'dropzone.formats': 'PNG, JPG, WebP hasta 100 MP / 80 MB',
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
    'progress.initAI': 'Inicializando motor IA...',
    'progress.total': 'Total:',
    'progress.downscaled': 'Imagen grande: procesando en {w}\u00D7{h} para ahorrar memoria (salida a {ow}\u00D7{oh} original).',

    // Download
    'download.btn': '\u2193 Descargar PNG limpio',
    'download.btnWebp': '\u2193 Descargar WebP limpio',
    'download.formatPng': 'PNG',
    'download.formatWebp': 'WebP',
    'download.copy': '\uD83D\uDCCB Copiar',
    'download.copied': '\u2713 \u00A1Copiado!',
    'download.copyFailed': 'Copia no soportada',
    'download.another': '\u21BB Procesar otra',

    // Editor
    'editor.tool': 'Herramienta:',
    'editor.shape': 'Forma:',
    'editor.eraser': 'Borrador',
    'editor.restore': 'Restaurar',
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
    'advanced.cta': '\u00BFInsatisfecho con el resultado? Us\u00E1 nuestro editor avanzado',
    'advanced.title': '[LAB] Editor avanzado',
    'advanced.toggleBefore': 'Antes',
    'advanced.toggleAfter': 'Despu\u00E9s',
    'advanced.apply': 'Aplicar',
    'advanced.cancel': 'Cancelar',
    'advanced.toolBrush': 'Pincel',
    'advanced.toolEraser': 'Borrador',
    'advanced.size': 'Tama\u00F1o',
    'advanced.hint': 'El pincel restaura desde el original. El borrador quita p\u00EDxeles.',
    'advanced.toolLasso': 'Lazo',
    'advanced.hintLasso': 'Dibuj\u00E1 un lazo a mano alzada. Arrastr\u00E1 los puntos para ajustar. Doble clic borra un punto.',
    'advanced.actionCrop': 'Recortar',
    'advanced.actionRefine': 'Re-detectar',
    'advanced.actionEraseArea': 'Borrar zona',
    'advanced.working': 'Procesando\u2026',
    'advanced.refineError': 'Fall\u00F3 la re-detecci\u00F3n',
    'advanced.undo': 'Deshacer',
    'advanced.redo': 'Rehacer',
    'advanced.zoom': 'Zoom',
    'advanced.zoomIn': 'Acercar',
    'advanced.zoomOut': 'Alejar',
    'advanced.zoomFit': 'Ajustar a la vista',

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
    'features.srTitle': 'Eliminador de fondos que nunca sube tus im\u00E1genes',
    'features.bgRemoval.title': 'Tus im\u00E1genes no salen.',
    'features.bgRemoval.desc': 'Cero subidas. Cero rastreo. El modelo de IA corre en tu navegador via WebAssembly. No conf\u00EDes en nosotros. Abre DevTools y revisa la pesta\u00F1a Red.',
    'features.aiArtifacts.title': 'Sabe qu\u00E9 le tiraste.',
    'features.aiArtifacts.desc': 'Foto, ilustraci\u00F3n, firma, icono. Lo clasificamos y elegimos el algoritmo correcto. No un modelo aplicado a ciegas a todo.',
    'features.private.title': 'Sin cuenta. Sin muro de pago. Sin trampa.',
    'features.private.desc': 'Usos ilimitados, sin marca de agua en el resultado, sin sistema de cr\u00E9ditos. Es GPL-3.0. Lee el c\u00F3digo.',
    'features.disclaimer': 'Somos <s>perfectos</s> honestos. A veces fallamos. Arr\u00E9glalo con el editor o <a href="https://github.com/yocreoquesi/nukebg/issues" target="_blank" rel="noopener">grita en el repo</a>.',
    'features.limitations': '\u2192 <strong>Funciona mejor con:</strong> sujetos claros sobre fondos contrastados, fotos, logos, firmas.<br>\u2192 <strong>Puede fallar con:</strong> pelo sobre fondos complejos, objetos semitransparentes, poses muy complejas.<br>\u2192 <strong>Consejo:</strong> usa el editor manual para corregir las zonas que no queden bien. El borrador te da control pixel a pixel.',

    // Header / Footer (index.html)
    'header.skipLink': 'Saltar al contenido principal',
    'footer.kofi': '\u2615 Apoyar en Ko-fi',
    'footer.privacy': 'Tus im\u00E1genes nunca salen de tu dispositivo. Cero subidas. Cero rollos.',

    // Pipeline error
    'pipeline.error': 'Procesamiento fallido: {msg}',

    // PWA
    'pwa.install': '[INSTALAR] Ejecutar local',
    'pwa.installed': 'Ejecutando localmente',
    'pwa.guideMotivation': '\u2622 Sin conexi\u00F3n. El reactor corre en tu dispositivo.',
    'pwa.guideFirefox': '1. Toca \u22EF (tres puntos, barra inferior)<br>2. Toca "\u2026 M\u00E1s"<br>3. Toca "A\u00F1adir app a la pantalla de inicio"',
    'pwa.guideSafari': '1. Toca el bot\u00F3n Compartir (\u2B06) en la barra inferior<br>2. Baja \u2192 toca "A\u00F1adir a pantalla de inicio"',
    'pwa.guideGeneric': '1. Abre el men\u00FA del navegador (\u22EE o \u22EF)<br>2. Busca "Instalar" o "A\u00F1adir a inicio"',
    'pwa.guideDismiss': '[ENTENDIDO]',

    // Batch mode
    'batch.processing': 'Procesando {current}/{total}',
    'batch.downloadZip': '\u2193 Descargar todas (ZIP)',
    'batch.failed': 'Fall\u00F3',
    'batch.retry': 'Reintentar',
    'batch.discard': 'Descartar',
    'batch.backToGrid': '\u2190 Volver al grid',
    'batch.limitExceeded': 'M\u00E1ximo {limit} im\u00E1genes. Tomamos las primeras {limit}.',
    'batch.pending': 'En cola',
    'batch.processingState': 'Procesando...',
    'batch.done': 'Listo',
    'batch.discarded': 'Descartada',
    'batch.completed': '{done}/{total} listas, {failed} fallidas',
    'batch.emptyZip': 'No hay im\u00E1genes procesadas para descargar',
    'batch.cancel': 'Cancelar lote',
    'dropzone.multi': 'Suelta hasta 12 im\u00E1genes para procesarlas juntas',

    // Language selector
    'lang.label': 'Idioma',
  },
  fr: {
    // Hero
    'hero.title.accent': 'Atomise',
    'hero.title.rest': "N'importe Quel Fond",
    'hero.subtitle': "Balance ton image. R\u00E9cup\u00E8re un PNG transparent.\nZ\u00E9ro upload. Z\u00E9ro compte. Z\u00E9ro baratin.",
    'hero.modelStatus': 'Pr\u00EAt \u00E0 atomiser',

    // Dropzone
    'dropzone.title': 'D\u00E9pose ton image ici',
    'dropzone.subtitle': 'ou clique pour parcourir. On atomise le fond',
    'dropzone.formats': 'PNG, JPG, WebP jusqu\u2019\u00E0 100 MP / 80 Mo',
    'dropzone.clipboard': 'Ctrl+V pour coller depuis le presse-papiers',
    'dropzone.dragover': 'L\u00E2che pour traiter',
    'dropzone.ariaLabel': "Charger une image pour supprimer l'arri\u00E8re-plan",
    'dropzone.errorFormat': 'Format non support\u00E9. Utilise PNG, JPG ou WebP.',

    // Progress
    'progress.detectBg': 'Analyse en cours...',
    'progress.watermarkScan': 'V\u00E9rification des filigranes',
    'progress.inpaint': 'Suppression du filigrane',
    'progress.bgRemoval': "Suppression de l'arri\u00E8re-plan",
    'progress.bgRemovalCV': "Suppression de l'arri\u00E8re-plan [CV]",
    'progress.bgRemovalML': "Suppression de l'arri\u00E8re-plan [ML]",
    'progress.initAI': "Initialisation du moteur IA...",
    'progress.total': 'Total :',
    'progress.downscaled': 'Grande image : traitement en {w}\u00D7{h} pour la m\u00E9moire (sortie en {ow}\u00D7{oh} d\u2019origine).',

    // Download
    'download.btn': '\u2193 T\u00E9l\u00E9charger PNG propre',
    'download.btnWebp': '\u2193 T\u00E9l\u00E9charger WebP propre',
    'download.formatPng': 'PNG',
    'download.formatWebp': 'WebP',
    'download.copy': '\uD83D\uDCCB Copier',
    'download.copied': '\u2713 Copi\u00E9 !',
    'download.copyFailed': 'Copie non support\u00E9e',
    'download.another': '\u21BB Traiter une autre',

    // Editor
    'editor.tool': 'Outil :',
    'editor.shape': 'Forme :',
    'editor.eraser': 'Gomme',
    'editor.restore': 'Restaurer',
    'editor.eraserCircle': 'Cercle',
    'editor.eraserSquare': 'Carr\u00E9',
    'editor.eraserSize': 'Taille :',
    'editor.undo': 'Annuler',
    'editor.redo': 'R\u00E9tablir',
    'editor.zoomFit': 'Ajuster',
    'editor.cancel': 'Annuler',
    'editor.apply': 'Appliquer',
    'editor.bg': 'Fond :',
    'editor.shortcuts': 'Raccourcis',
    'editor.shortcutErase': 'Gommer',
    'editor.shortcutEraserSize': 'Taille gomme \u00B15',
    'editor.shortcutZoom': 'Zoom',
    'editor.shortcutPan': 'D\u00E9placer',
    'editor.shortcutResetView': 'R\u00E9initialiser la vue',
    'editor.shortcutUndo': 'Annuler',
    'editor.shortcutRedo': 'R\u00E9tablir',

    // Edit button (ar-app)
    'edit.btn': 'Pas assez propre ? \u00C9dite \u00E0 la main',
    'edit.discard': '\u21A9 Annuler les modifications',
    'advanced.cta': 'R\u00E9sultat pas convaincant ? Essaie notre \u00E9diteur avanc\u00E9',
    'advanced.title': '[LAB] \u00C9diteur avanc\u00E9',
    'advanced.toggleBefore': 'Avant',
    'advanced.toggleAfter': 'Apr\u00E8s',
    'advanced.apply': 'Appliquer',
    'advanced.cancel': 'Annuler',
    'advanced.toolBrush': 'Pinceau',
    'advanced.toolEraser': 'Gomme',
    'advanced.size': 'Taille',
    'advanced.hint': 'Le pinceau restaure depuis l\u2019original. La gomme efface les pixels.',
    'advanced.toolLasso': 'Lasso',
    'advanced.hintLasso': 'Dessine une boucle \u00E0 main lev\u00E9e. Glisse les poign\u00E9es pour ajuster. Double-clic pour supprimer une poign\u00E9e.',
    'advanced.actionCrop': 'Recadrer',
    'advanced.actionRefine': 'Red\u00E9tecter',
    'advanced.actionEraseArea': 'Effacer la zone',
    'advanced.working': 'Traitement\u2026',
    'advanced.refineError': '\u00C9chec de la red\u00E9tection',
    'advanced.undo': 'Annuler',
    'advanced.redo': 'R\u00E9tablir',
    'advanced.zoom': 'Zoom',
    'advanced.zoomIn': 'Zoom avant',
    'advanced.zoomOut': 'Zoom arri\u00E8re',
    'advanced.zoomFit': 'Ajuster \u00E0 la vue',

    // Viewer
    'viewer.original': 'Avant',
    'viewer.result': 'Apr\u00E8s',
    'viewer.bg': 'Fond :',

    // Privacy
    'privacy.badge': '\uD83D\uDD12 100% c\u00F4t\u00E9 client',
    'privacy.tooltip.line1': 'Tes images ne quittent jamais ton appareil.',
    'privacy.tooltip.line2': 'Tout le traitement se fait dans ton navigateur.',
    'privacy.tooltip.line3': "V\u00E9rifie : ouvre l'onglet R\u00E9seau dans DevTools.",

    // Features
    'features.srTitle': "D\u00E9tourage qui n'uploade jamais tes images",
    'features.bgRemoval.title': 'Tes images ne sortent pas.',
    'features.bgRemoval.desc': "Z\u00E9ro upload. Z\u00E9ro tracking. Le mod\u00E8le IA tourne dans ton navigateur via WebAssembly. Ne nous fais pas confiance. Ouvre DevTools et v\u00E9rifie l'onglet R\u00E9seau.",
    'features.aiArtifacts.title': 'Il sait ce que tu lui as fil\u00E9.',
    'features.aiArtifacts.desc': "Photo, illustration, signature, ic\u00F4ne. On classifie et on choisit le bon algorithme. Pas un mod\u00E8le appliqu\u00E9 \u00E0 l'aveugle sur tout.",
    'features.private.title': 'Ni compte. Ni paywall. Ni entourloupe.',
    'features.private.desc': "Utilisations illimit\u00E9es, pas de filigrane sur le r\u00E9sultat, pas de syst\u00E8me de cr\u00E9dits. GPL-3.0. Va lire le code.",
    'features.disclaimer': "On est <s>parfaits</s> honn\u00EAtes. Parfois on rate. Corrige avec l'\u00E9diteur ou <a href=\"https://github.com/yocreoquesi/nukebg/issues\" target=\"_blank\" rel=\"noopener\">gueule sur le repo</a>.",
    'features.limitations': "\u2192 <strong>Marche mieux avec :</strong> sujets nets sur fond contrast\u00E9, photos, logos, signatures.<br>\u2192 <strong>Peut galérer avec :</strong> cheveux sur fonds charg\u00E9s, objets semi-transparents, poses tr\u00E8s complexes.<br>\u2192 <strong>Astuce :</strong> utilise l'\u00E9diteur manuel pour corriger les zones approximatives. La gomme te donne le contr\u00F4le au pixel.",

    // Header / Footer (index.html)
    'header.skipLink': 'Aller au contenu principal',
    'footer.kofi': '\u2615 Soutenir sur Ko-fi',
    'footer.privacy': 'Tes images ne quittent jamais ton appareil. Z\u00E9ro upload. Z\u00E9ro baratin.',

    // Pipeline error
    'pipeline.error': 'Traitement \u00E9chou\u00E9 : {msg}',

    // PWA
    'pwa.install': '[INSTALLER] Ex\u00E9cuter en local',
    'pwa.installed': 'Ex\u00E9cution locale',
    'pwa.guideMotivation': '\u2622 Hors-ligne. Le r\u00E9acteur tourne sur ton appareil.',
    'pwa.guideFirefox': '1. Appuie sur \u22EF (trois points, barre du bas)<br>2. Appuie sur "\u2026 Plus"<br>3. Appuie sur "Ajouter l\u2019appli \u00E0 l\u2019\u00E9cran d\u2019accueil"',
    'pwa.guideSafari': '1. Appuie sur Partager (\u2B06) dans la barre du bas<br>2. Descends \u2192 appuie sur "Sur l\u2019\u00E9cran d\u2019accueil"',
    'pwa.guideGeneric': '1. Ouvre le menu du navigateur (\u22EE ou \u22EF)<br>2. Cherche "Installer" ou "Ajouter \u00E0 l\u2019\u00E9cran d\u2019accueil"',
    'pwa.guideDismiss': '[RE\u00C7U]',

    // Batch mode
    'batch.processing': 'Traitement {current}/{total}',
    'batch.downloadZip': '\u2193 Tout t\u00E9l\u00E9charger (ZIP)',
    'batch.failed': '\u00C9chec',
    'batch.retry': 'R\u00E9essayer',
    'batch.discard': 'Supprimer',
    'batch.backToGrid': '\u2190 Retour \u00E0 la grille',
    'batch.limitExceeded': 'Max {limit} images. Les {limit} premi\u00E8res sont prises.',
    'batch.pending': 'En attente',
    'batch.processingState': 'Traitement...',
    'batch.done': 'Termin\u00E9',
    'batch.discarded': 'Supprim\u00E9e',
    'batch.completed': '{done}/{total} pr\u00EAtes, {failed} \u00E9chou\u00E9es',
    'batch.emptyZip': 'Aucune image pr\u00EAte \u00E0 t\u00E9l\u00E9charger',
    'batch.cancel': 'Annuler le lot',
    'dropzone.multi': 'D\u00E9pose jusqu\u2019\u00E0 12 images pour le mode lot',

    // Language selector
    'lang.label': 'Langue',
  },
  de: {
    // Hero
    'hero.title.accent': 'Nuke',
    'hero.title.rest': 'Jeden Hintergrund',
    'hero.subtitle': 'Bild reinwerfen. Transparentes PNG kriegen.\nKein Upload. Kein Konto. Kein Bullshit.',
    'hero.modelStatus': 'Bereit zum Nuken',

    // Dropzone
    'dropzone.title': 'Bild hier ablegen',
    'dropzone.subtitle': 'oder klicken zum Ausw\u00E4hlen. Wir nuken den Hintergrund',
    'dropzone.formats': 'PNG, JPG, WebP bis 100 MP / 80 MB',
    'dropzone.clipboard': 'Strg+V zum Einf\u00FCgen aus Zwischenablage',
    'dropzone.dragover': 'Loslassen zum Verarbeiten',
    'dropzone.ariaLabel': 'Bild hochladen zur Hintergrundentfernung',
    'dropzone.errorFormat': 'Format nicht unterst\u00FCtzt. Nutze PNG, JPG oder WebP.',

    // Progress
    'progress.detectBg': 'Bild wird gescannt...',
    'progress.watermarkScan': 'Wasserzeichen-Check',
    'progress.inpaint': 'Wasserzeichen entfernen',
    'progress.bgRemoval': 'Hintergrund entfernen',
    'progress.bgRemovalCV': 'Hintergrund entfernen [CV]',
    'progress.bgRemovalML': 'Hintergrund entfernen [ML]',
    'progress.initAI': 'KI-Engine wird initialisiert...',
    'progress.total': 'Gesamt:',
    'progress.downscaled': 'Gro\u00DFes Bild: Verarbeitung bei {w}\u00D7{h} zur Speicherschonung (Ausgabe in Original {ow}\u00D7{oh}).',

    // Download
    'download.btn': '\u2193 Sauberes PNG laden',
    'download.btnWebp': '\u2193 Sauberes WebP laden',
    'download.formatPng': 'PNG',
    'download.formatWebp': 'WebP',
    'download.copy': '\uD83D\uDCCB Kopieren',
    'download.copied': '\u2713 Kopiert!',
    'download.copyFailed': 'Kopieren nicht m\u00F6glich',
    'download.another': '\u21BB N\u00E4chstes Bild',

    // Editor
    'editor.tool': 'Werkzeug:',
    'editor.shape': 'Form:',
    'editor.eraser': 'Radierer',
    'editor.restore': 'Wiederherstellen',
    'editor.eraserCircle': 'Kreis',
    'editor.eraserSquare': 'Quadrat',
    'editor.eraserSize': 'Gr\u00F6\u00DFe:',
    'editor.undo': 'R\u00FCckg\u00E4ngig',
    'editor.redo': 'Wiederholen',
    'editor.zoomFit': 'Einpassen',
    'editor.cancel': 'Abbrechen',
    'editor.apply': '\u00C4nderungen anwenden',
    'editor.bg': 'HG:',
    'editor.shortcuts': 'Tastaturk\u00FCrzel',
    'editor.shortcutErase': 'Radieren',
    'editor.shortcutEraserSize': 'Radierer-Gr\u00F6\u00DFe \u00B15',
    'editor.shortcutZoom': 'Zoom',
    'editor.shortcutPan': 'Verschieben',
    'editor.shortcutResetView': 'Ansicht zur\u00FCcksetzen',
    'editor.shortcutUndo': 'R\u00FCckg\u00E4ngig',
    'editor.shortcutRedo': 'Wiederholen',

    // Edit button (ar-app)
    'edit.btn': 'Nicht sauber genug? Manuell nachbessern',
    'edit.discard': '\u21A9 \u00C4nderungen verwerfen',
    'advanced.cta': 'Nicht zufrieden mit dem Ergebnis? Probier unseren erweiterten Editor',
    'advanced.title': '[LAB] Erweiterter Editor',
    'advanced.toggleBefore': 'Vorher',
    'advanced.toggleAfter': 'Nachher',
    'advanced.apply': 'Anwenden',
    'advanced.cancel': 'Abbrechen',
    'advanced.toolBrush': 'Pinsel',
    'advanced.toolEraser': 'Radierer',
    'advanced.size': 'Gr\u00F6\u00DFe',
    'advanced.hint': 'Pinsel stellt aus dem Original wieder her. Radierer entfernt Pixel.',
    'advanced.toolLasso': 'Lasso',
    'advanced.hintLasso': 'Zieh eine Freihandschleife. Zieh an den Griffen zum Anpassen. Doppelklick entfernt einen Griff.',
    'advanced.actionCrop': 'Zuschneiden',
    'advanced.actionRefine': 'Neu erkennen',
    'advanced.actionEraseArea': 'Bereich l\u00F6schen',
    'advanced.working': 'Verarbeitung\u2026',
    'advanced.refineError': 'Neuerkennung fehlgeschlagen',
    'advanced.undo': 'R\u00FCckg\u00E4ngig',
    'advanced.redo': 'Wiederholen',
    'advanced.zoom': 'Zoom',
    'advanced.zoomIn': 'Vergr\u00F6\u00DFern',
    'advanced.zoomOut': 'Verkleinern',
    'advanced.zoomFit': 'An Ansicht anpassen',

    // Viewer
    'viewer.original': 'Vorher',
    'viewer.result': 'Nachher',
    'viewer.bg': 'HG:',

    // Privacy
    'privacy.badge': '\uD83D\uDD12 100% Client-seitig',
    'privacy.tooltip.line1': 'Deine Bilder verlassen nie dein Ger\u00E4t.',
    'privacy.tooltip.line2': 'Alles wird in deinem Browser verarbeitet.',
    'privacy.tooltip.line3': 'Pr\u00FCfe selbst: Netzwerk-Tab in DevTools \u00F6ffnen.',

    // Features
    'features.srTitle': 'Hintergrundentfernung, die deine Bilder nie hochl\u00E4dt',
    'features.bgRemoval.title': 'Deine Bilder bleiben bei dir.',
    'features.bgRemoval.desc': 'Null Uploads. Null Tracking. Das KI-Modell l\u00E4uft im Browser via WebAssembly. Vertrau uns nicht. \u00D6ffne DevTools und check den Netzwerk-Tab.',
    'features.aiArtifacts.title': 'Erkennt, was du reingeworfen hast.',
    'features.aiArtifacts.desc': 'Foto, Illustration, Unterschrift, Icon. Wir klassifizieren und w\u00E4hlen den richtigen Algorithmus. Kein Modell, das blind auf alles losgelassen wird.',
    'features.private.title': 'Kein Konto. Keine Paywall. Kein Haken.',
    'features.private.desc': 'Unbegrenzt nutzbar, kein Wasserzeichen, kein Credit-System. GPL-3.0. Lies den Code.',
    'features.disclaimer': 'Wir sind <s>perfekt</s> ehrlich. Manchmal daneben. Nachbessern im Editor oder <a href="https://github.com/yocreoquesi/nukebg/issues" target="_blank" rel="noopener">im Repo meckern</a>.',
    'features.limitations': '\u2192 <strong>Funktioniert am besten mit:</strong> klare Motive vor kontrastreichem Hintergrund, Fotos, Logos, Unterschriften.<br>\u2192 <strong>Kann Probleme haben mit:</strong> Haare vor unruhigem Hintergrund, halbtransparente Objekte, sehr komplexe Posen.<br>\u2192 <strong>Tipp:</strong> nutze den manuellen Editor f\u00FCr unsaubere Stellen. Der Radierer gibt dir Kontrolle auf Pixelebene.',

    // Header / Footer (index.html)
    'header.skipLink': 'Zum Hauptinhalt springen',
    'footer.kofi': '\u2615 Unterst\u00FCtzen auf Ko-fi',
    'footer.privacy': 'Deine Bilder verlassen nie dein Ger\u00E4t. Null Uploads. Null Bullshit.',

    // Pipeline error
    'pipeline.error': 'Verarbeitung fehlgeschlagen: {msg}',

    // PWA
    'pwa.install': '[INSTALLIEREN] Lokal ausf\u00FChren',
    'pwa.installed': 'L\u00E4uft lokal',
    'pwa.guideMotivation': '\u2622 Offline gehen. Der Reaktor l\u00E4uft auf deinem Ger\u00E4t.',
    'pwa.guideFirefox': '1. Tippe auf \u22EF (drei Punkte, untere Leiste)<br>2. Tippe auf "\u2026 Mehr"<br>3. Tippe auf "App zum Startbildschirm hinzuf\u00FCgen"',
    'pwa.guideSafari': '1. Tippe auf Teilen (\u2B06) in der unteren Leiste<br>2. Runterscrollen \u2192 "Zum Home-Bildschirm" tippen',
    'pwa.guideGeneric': '1. \u00D6ffne das Browser-Men\u00FC (\u22EE oder \u22EF)<br>2. Suche "Installieren" oder "Zum Startbildschirm"',
    'pwa.guideDismiss': '[VERSTANDEN]',

    // Batch mode
    'batch.processing': 'Verarbeite {current}/{total}',
    'batch.downloadZip': '\u2193 Alle als ZIP herunterladen',
    'batch.failed': 'Fehlgeschlagen',
    'batch.retry': 'Wiederholen',
    'batch.discard': 'Verwerfen',
    'batch.backToGrid': '\u2190 Zur\u00FCck zum Raster',
    'batch.limitExceeded': 'Max. {limit} Bilder. Die ersten {limit} werden genommen.',
    'batch.pending': 'Warteschlange',
    'batch.processingState': 'Verarbeite...',
    'batch.done': 'Fertig',
    'batch.discarded': 'Verworfen',
    'batch.completed': '{done}/{total} fertig, {failed} fehlgeschlagen',
    'batch.emptyZip': 'Keine fertigen Bilder zum Herunterladen',
    'batch.cancel': 'Stapel abbrechen',
    'dropzone.multi': 'Bis zu 12 Bilder f\u00FCr den Stapelmodus ablegen',

    // Language selector
    'lang.label': 'Sprache',
  },
  pt: {
    // Hero
    'hero.title.accent': 'Nukeia',
    'hero.title.rest': 'Qualquer Fundo',
    'hero.subtitle': 'Joga a imagem. Pega o PNG transparente.\nSem upload. Sem conta. Sem frescura.',
    'hero.modelStatus': 'Pronto pra nukear',

    // Dropzone
    'dropzone.title': 'Solta a imagem aqui',
    'dropzone.subtitle': 'ou clica pra escolher. A gente nukeia o fundo',
    'dropzone.formats': 'PNG, JPG, WebP at\u00E9 100 MP / 80 MB',
    'dropzone.clipboard': 'Ctrl+V pra colar da \u00E1rea de transfer\u00EAncia',
    'dropzone.dragover': 'Solta pra processar',
    'dropzone.ariaLabel': 'Enviar imagem para remover fundo',
    'dropzone.errorFormat': 'Formato n\u00E3o suportado. Usa PNG, JPG ou WebP.',

    // Progress
    'progress.detectBg': 'Escaneando imagem...',
    'progress.watermarkScan': 'Procurando marcas d\u2019\u00E1gua',
    'progress.inpaint': 'Removendo marca d\u2019\u00E1gua',
    'progress.bgRemoval': 'Removendo fundo',
    'progress.bgRemovalCV': 'Removendo fundo [CV]',
    'progress.bgRemovalML': 'Removendo fundo [ML]',
    'progress.initAI': 'Inicializando motor de IA...',
    'progress.total': 'Total:',
    'progress.downscaled': 'Imagem grande: processando em {w}\u00D7{h} para economizar mem\u00F3ria (sa\u00EDda em {ow}\u00D7{oh} original).',

    // Download
    'download.btn': '\u2193 Baixar PNG limpo',
    'download.btnWebp': '\u2193 Baixar WebP limpo',
    'download.formatPng': 'PNG',
    'download.formatWebp': 'WebP',
    'download.copy': '\uD83D\uDCCB Copiar',
    'download.copied': '\u2713 Copiado!',
    'download.copyFailed': 'C\u00F3pia n\u00E3o suportada',
    'download.another': '\u21BB Processar outra',

    // Editor
    'editor.tool': 'Ferramenta:',
    'editor.shape': 'Forma:',
    'editor.eraser': 'Borracha',
    'editor.restore': 'Restaurar',
    'editor.eraserCircle': 'C\u00EDrculo',
    'editor.eraserSquare': 'Quadrado',
    'editor.eraserSize': 'Tamanho:',
    'editor.undo': 'Desfazer',
    'editor.redo': 'Refazer',
    'editor.zoomFit': 'Ajustar',
    'editor.cancel': 'Cancelar',
    'editor.apply': 'Aplicar edi\u00E7\u00E3o',
    'editor.bg': 'Fundo:',
    'editor.shortcuts': 'Atalhos',
    'editor.shortcutErase': 'Apagar',
    'editor.shortcutEraserSize': 'Tamanho borracha \u00B15',
    'editor.shortcutZoom': 'Zoom',
    'editor.shortcutPan': 'Mover',
    'editor.shortcutResetView': 'Resetar vista',
    'editor.shortcutUndo': 'Desfazer',
    'editor.shortcutRedo': 'Refazer',

    // Edit button (ar-app)
    'edit.btn': 'N\u00E3o ficou limpo? Edita na m\u00E3o',
    'edit.discard': '\u21A9 Descartar edi\u00E7\u00E3o',
    'advanced.cta': 'N\u00E3o satisfeito com o resultado? Usa o nosso editor avan\u00E7ado',
    'advanced.title': '[LAB] Editor avan\u00E7ado',
    'advanced.toggleBefore': 'Antes',
    'advanced.toggleAfter': 'Depois',
    'advanced.apply': 'Aplicar',
    'advanced.cancel': 'Cancelar',
    'advanced.toolBrush': 'Pincel',
    'advanced.toolEraser': 'Borracha',
    'advanced.size': 'Tamanho',
    'advanced.hint': 'O pincel restaura do original. A borracha remove p\u00EDxeis.',
    'advanced.toolLasso': 'La\u00E7o',
    'advanced.hintLasso': 'Desenha um la\u00E7o \u00E0 m\u00E3o. Arrasta as al\u00E7as para ajustar. Duplo clique remove uma al\u00E7a.',
    'advanced.actionCrop': 'Recortar',
    'advanced.actionRefine': 'Re-detetar',
    'advanced.actionEraseArea': 'Apagar zona',
    'advanced.working': 'A processar\u2026',
    'advanced.refineError': 'Falhou a re-dete\u00E7\u00E3o',
    'advanced.undo': 'Desfazer',
    'advanced.redo': 'Refazer',
    'advanced.zoom': 'Zoom',
    'advanced.zoomIn': 'Aproximar',
    'advanced.zoomOut': 'Afastar',
    'advanced.zoomFit': 'Ajustar \u00E0 vista',

    // Viewer
    'viewer.original': 'Antes',
    'viewer.result': 'Depois',
    'viewer.bg': 'Fundo:',

    // Privacy
    'privacy.badge': '\uD83D\uDD12 100% no seu navegador',
    'privacy.tooltip.line1': 'Suas imagens nunca saem do seu dispositivo.',
    'privacy.tooltip.line2': 'Todo o processamento roda no seu navegador.',
    'privacy.tooltip.line3': 'Confere: abre a aba Rede no DevTools.',

    // Features
    'features.srTitle': 'Removedor de fundo que nunca sobe suas imagens',
    'features.bgRemoval.title': 'Suas imagens n\u00E3o saem daqui.',
    'features.bgRemoval.desc': 'Zero uploads. Zero rastreamento. O modelo de IA roda no seu navegador via WebAssembly. N\u00E3o confia na gente? Abre o DevTools e confere a aba Rede.',
    'features.aiArtifacts.title': 'Ele sabe o que voc\u00EA jogou.',
    'features.aiArtifacts.desc': 'Foto, ilustra\u00E7\u00E3o, assinatura, \u00EDcone. A gente classifica e escolhe o algoritmo certo. Nada de um modelo cego aplicado em tudo.',
    'features.private.title': 'Sem conta. Sem paywall. Sem pegadinha.',
    'features.private.desc': 'Uso ilimitado, sem marca d\u2019\u00E1gua no resultado, sem sistema de cr\u00E9ditos. GPL-3.0. Vai ler o c\u00F3digo.',
    'features.disclaimer': 'Somos <s>perfeitos</s> honestos. \u00C0s vezes erramos. Arruma no editor ou <a href="https://github.com/yocreoquesi/nukebg/issues" target="_blank" rel="noopener">xinga no repo</a>.',
    'features.limitations': '\u2192 <strong>Funciona melhor com:</strong> sujeitos n\u00EDtidos em fundos contrastados, fotos, logos, assinaturas.<br>\u2192 <strong>Pode penar com:</strong> cabelo em fundos complexos, objetos semitransparentes, poses muito complicadas.<br>\u2192 <strong>Dica:</strong> usa o editor manual pra corrigir as partes que ficaram estranhas. A borracha d\u00E1 controle pixel a pixel.',

    // Header / Footer (index.html)
    'header.skipLink': 'Pular para o conte\u00FAdo principal',
    'footer.kofi': '\u2615 Apoiar no Ko-fi',
    'footer.privacy': 'Suas imagens nunca saem do seu dispositivo. Zero uploads. Zero enrola\u00E7\u00E3o.',

    // Pipeline error
    'pipeline.error': 'Processamento falhou: {msg}',

    // PWA
    'pwa.install': '[INSTALAR] Rodar local',
    'pwa.installed': 'Rodando localmente',
    'pwa.guideMotivation': '\u2622 Sem rede. O reator roda no teu dispositivo.',
    'pwa.guideFirefox': '1. Toca em \u22EF (tr\u00EAs pontos, barra inferior)<br>2. Toca em "\u2026 Mais"<br>3. Toca em "Adicionar app \u00E0 tela inicial"',
    'pwa.guideSafari': '1. Toca em Compartilhar (\u2B06) na barra inferior<br>2. Desce \u2192 toca em "Adicionar \u00E0 Tela de In\u00EDcio"',
    'pwa.guideGeneric': '1. Abre o menu do navegador (\u22EE ou \u22EF)<br>2. Procura "Instalar" ou "Adicionar \u00E0 tela inicial"',
    'pwa.guideDismiss': '[ENTENDIDO]',

    // Batch mode
    'batch.processing': 'Processando {current}/{total}',
    'batch.downloadZip': '\u2193 Baixar todas (ZIP)',
    'batch.failed': 'Falhou',
    'batch.retry': 'Tentar novamente',
    'batch.discard': 'Descartar',
    'batch.backToGrid': '\u2190 Voltar \u00E0 grade',
    'batch.limitExceeded': 'M\u00E1ximo {limit} imagens. Pegando as primeiras {limit}.',
    'batch.pending': 'Na fila',
    'batch.processingState': 'Processando...',
    'batch.done': 'Pronto',
    'batch.discarded': 'Descartada',
    'batch.completed': '{done}/{total} prontas, {failed} falharam',
    'batch.emptyZip': 'Sem imagens prontas para baixar',
    'batch.cancel': 'Cancelar lote',
    'dropzone.multi': 'Solta at\u00E9 12 imagens pra modo em lote',

    // Language selector
    'lang.label': 'Idioma',
  },
  zh: {
    // Hero
    'hero.title.accent': '\u6838\u7206',
    'hero.title.rest': '\u4EFB\u4F55\u80CC\u666F',
    'hero.subtitle': '\u4E22\u5F20\u56FE\u7247\u8FDB\u6765\u3002\u62FF\u8D70\u900F\u660E PNG\u3002\n\u96F6\u4E0A\u4F20\u3002\u96F6\u6CE8\u518C\u3002\u96F6\u5E9F\u8BDD\u3002',
    'hero.modelStatus': '\u51C6\u5907\u6838\u7206',

    // Dropzone
    'dropzone.title': '\u628A\u56FE\u7247\u4E22\u8FD9\u91CC',
    'dropzone.subtitle': '\u6216\u8005\u70B9\u51FB\u9009\u62E9\uFF0C\u6211\u4EEC\u6765\u6838\u7206\u80CC\u666F',
    'dropzone.formats': 'PNG, JPG, WebP \u6700\u5927 100 MP / 80 MB',
    'dropzone.clipboard': 'Ctrl+V \u4ECE\u526A\u8D34\u677F\u7C98\u8D34',
    'dropzone.dragover': '\u677E\u624B\u5F00\u59CB\u5904\u7406',
    'dropzone.ariaLabel': '\u4E0A\u4F20\u56FE\u7247\u4EE5\u53BB\u9664\u80CC\u666F',
    'dropzone.errorFormat': '\u4E0D\u652F\u6301\u7684\u683C\u5F0F\u3002\u8BF7\u7528 PNG\u3001JPG \u6216 WebP\u3002',

    // Progress
    'progress.detectBg': '\u626B\u63CF\u56FE\u7247\u4E2D...',
    'progress.watermarkScan': '\u68C0\u67E5\u6C34\u5370',
    'progress.inpaint': '\u6E05\u9664\u6C34\u5370',
    'progress.bgRemoval': '\u53BB\u9664\u80CC\u666F',
    'progress.bgRemovalCV': '\u53BB\u9664\u80CC\u666F [CV]',
    'progress.bgRemovalML': '\u53BB\u9664\u80CC\u666F [ML]',
    'progress.initAI': 'AI \u5F15\u64CE\u521D\u59CB\u5316\u4E2D...',
    'progress.total': '\u603B\u8BA1:',
    'progress.downscaled': '\u5927\u56FE\u50CF\uFF1A\u4EE5 {w}\u00D7{h} \u5904\u7406\u4EE5\u8282\u7701\u5185\u5B58\uFF08\u8F93\u51FA\u4F4D\u539F\u59CB {ow}\u00D7{oh}\uFF09\u3002',

    // Download
    'download.btn': '\u2193 \u4E0B\u8F7D\u5E72\u51C0 PNG',
    'download.btnWebp': '\u2193 \u4E0B\u8F7D\u5E72\u51C0 WebP',
    'download.formatPng': 'PNG',
    'download.formatWebp': 'WebP',
    'download.copy': '\uD83D\uDCCB \u590D\u5236',
    'download.copied': '\u2713 \u5DF2\u590D\u5236\uFF01',
    'download.copyFailed': '\u4E0D\u652F\u6301\u590D\u5236',
    'download.another': '\u21BB \u518D\u5904\u7406\u4E00\u5F20',

    // Editor
    'editor.tool': '\u5DE5\u5177\uFF1A',
    'editor.shape': '\u5F62\u72B6\uFF1A',
    'editor.eraser': '\u6A61\u76AE\u64E6',
    'editor.restore': '\u6062\u590D',
    'editor.eraserCircle': '\u5706\u5F62',
    'editor.eraserSquare': '\u65B9\u5F62',
    'editor.eraserSize': '\u5927\u5C0F:',
    'editor.undo': '\u64A4\u9500',
    'editor.redo': '\u91CD\u505A',
    'editor.zoomFit': '\u9002\u5E94',
    'editor.cancel': '\u53D6\u6D88',
    'editor.apply': '\u5E94\u7528\u7F16\u8F91',
    'editor.bg': '\u80CC\u666F:',
    'editor.shortcuts': '\u5FEB\u6377\u952E',
    'editor.shortcutErase': '\u64E6\u9664',
    'editor.shortcutEraserSize': '\u6A61\u76AE\u64E6\u5927\u5C0F \u00B15',
    'editor.shortcutZoom': '\u7F29\u653E',
    'editor.shortcutPan': '\u5E73\u79FB',
    'editor.shortcutResetView': '\u91CD\u7F6E\u89C6\u56FE',
    'editor.shortcutUndo': '\u64A4\u9500',
    'editor.shortcutRedo': '\u91CD\u505A',

    // Edit button (ar-app)
    'edit.btn': '\u4E0D\u591F\u5E72\u51C0\uFF1F\u624B\u52A8\u7F16\u8F91',
    'edit.discard': '\u21A9 \u4E22\u5F03\u7F16\u8F91',
    'advanced.cta': '\u5BF9\u7ED3\u679C\u4E0D\u6EE1\u610F\uFF1F\u8BD5\u8BD5\u6211\u4EEC\u7684\u9AD8\u7EA7\u7F16\u8F91\u5668',
    'advanced.title': '[LAB] \u9AD8\u7EA7\u7F16\u8F91\u5668',
    'advanced.toggleBefore': '\u4E4B\u524D',
    'advanced.toggleAfter': '\u4E4B\u540E',
    'advanced.apply': '\u5E94\u7528',
    'advanced.cancel': '\u53D6\u6D88',
    'advanced.toolBrush': '\u753B\u7B14',
    'advanced.toolEraser': '\u6A61\u76AE\u64E6',
    'advanced.size': '\u5927\u5C0F',
    'advanced.hint': '\u753B\u7B14\u4ECE\u539F\u56FE\u6062\u590D\u50CF\u7D20\u3002\u6A61\u76AE\u64E6\u79FB\u9664\u50CF\u7D20\u3002',
    'advanced.toolLasso': '\u5957\u7D22',
    'advanced.hintLasso': '\u7ED8\u5236\u4E00\u4E2A\u624B\u7ED8\u73AF\u3002\u62D6\u52A8\u624B\u67C4\u8FDB\u884C\u8C03\u6574\u3002\u53CC\u51FB\u624B\u67C4\u5220\u9664\u3002',
    'advanced.actionCrop': '\u88C1\u526A',
    'advanced.actionRefine': '\u91CD\u65B0\u68C0\u6D4B',
    'advanced.actionEraseArea': '\u64E6\u9664\u533A\u57DF',
    'advanced.working': '\u5904\u7406\u4E2D\u2026',
    'advanced.refineError': '\u91CD\u65B0\u68C0\u6D4B\u5931\u8D25',
    'advanced.undo': '\u64A4\u9500',
    'advanced.redo': '\u91CD\u505A',
    'advanced.zoom': '\u7F29\u653E',
    'advanced.zoomIn': '\u653E\u5927',
    'advanced.zoomOut': '\u7F29\u5C0F',
    'advanced.zoomFit': '\u9002\u5408\u89C6\u56FE',

    // Viewer
    'viewer.original': '\u539F\u56FE',
    'viewer.result': '\u7ED3\u679C',
    'viewer.bg': '\u80CC\u666F:',

    // Privacy
    'privacy.badge': '\uD83D\uDD12 100% \u672C\u5730\u5904\u7406',
    'privacy.tooltip.line1': '\u4F60\u7684\u56FE\u7247\u6C38\u8FDC\u4E0D\u4F1A\u79BB\u5F00\u4F60\u7684\u8BBE\u5907\u3002',
    'privacy.tooltip.line2': '\u6240\u6709\u5904\u7406\u5747\u5728\u6D4F\u89C8\u5668\u4E2D\u5B8C\u6210\u3002',
    'privacy.tooltip.line3': '\u9A8C\u8BC1\uFF1A\u6253\u5F00 DevTools \u67E5\u770B\u7F51\u7EDC\u9762\u677F\u3002',

    // Features
    'features.srTitle': '\u6C38\u8FDC\u4E0D\u4F1A\u4E0A\u4F20\u4F60\u56FE\u7247\u7684\u80CC\u666F\u53BB\u9664\u5DE5\u5177',
    'features.bgRemoval.title': '\u4F60\u7684\u56FE\u7247\u54EA\u513F\u4E5F\u4E0D\u53BB\u3002',
    'features.bgRemoval.desc': '\u96F6\u4E0A\u4F20\u3002\u96F6\u8FFD\u8E2A\u3002AI\u6A21\u578B\u901A\u8FC7 WebAssembly \u5728\u4F60\u7684\u6D4F\u89C8\u5668\u91CC\u8FD0\u884C\u3002\u522B\u4FE1\u6211\u4EEC\u7684\u8BDD\u3002\u6253\u5F00 DevTools \u81EA\u5DF1\u770B\u7F51\u7EDC\u9762\u677F\u3002',
    'features.aiArtifacts.title': '\u5B83\u77E5\u9053\u4F60\u4E22\u4E86\u4EC0\u4E48\u3002',
    'features.aiArtifacts.desc': '\u7167\u7247\u3001\u63D2\u753B\u3001\u7B7E\u540D\u3001\u56FE\u6807\u3002\u6211\u4EEC\u5148\u5206\u7C7B\uFF0C\u518D\u9009\u7B97\u6CD5\u3002\u4E0D\u662F\u4E00\u4E2A\u6A21\u578B\u65E0\u8111\u5957\u5728\u6240\u6709\u4E1C\u897F\u4E0A\u3002',
    'features.private.title': '\u4E0D\u7528\u6CE8\u518C\u3002\u4E0D\u7528\u4ED8\u8D39\u3002\u6CA1\u6709\u5957\u8DEF\u3002',
    'features.private.desc': '\u65E0\u9650\u4F7F\u7528\uFF0C\u8F93\u51FA\u65E0\u6C34\u5370\uFF0C\u6CA1\u6709\u79EF\u5206\u5236\u3002GPL-3.0\u3002\u53BB\u770B\u6E90\u7801\u3002',
    'features.disclaimer': '\u6211\u4EEC<s>\u5B8C\u7F8E</s>\u8BDA\u5B9E\u3002\u6709\u65F6\u7FFB\u8F66\u3002\u7528\u7F16\u8F91\u5668\u4FEE\uFF0C\u6216<a href="https://github.com/yocreoquesi/nukebg/issues" target="_blank" rel="noopener">\u53BB repo \u5410\u69FD</a>\u3002',
    'features.limitations': '\u2192 <strong>\u6700\u9002\u5408\uFF1A</strong>\u6E05\u6670\u4E3B\u4F53\u914D\u5BF9\u6BD4\u660E\u663E\u7684\u80CC\u666F\u3001\u7167\u7247\u3001logo\u3001\u7B7E\u540D\u3002<br>\u2192 <strong>\u53EF\u80FD\u7FFB\u8F66\uFF1A</strong>\u590D\u6742\u80CC\u666F\u4E0A\u7684\u5934\u53D1\u3001\u534A\u900F\u660E\u7269\u4F53\u3001\u975E\u5E38\u590D\u6742\u7684\u59FF\u52BF\u3002<br>\u2192 <strong>\u5C0F\u8D34\u58EB\uFF1A</strong>\u7528\u624B\u52A8\u7F16\u8F91\u5668\u4FEE\u590D\u4E0D\u5B8C\u7F8E\u7684\u5730\u65B9\u3002\u6A61\u76AE\u64E6\u7ED9\u4F60\u50CF\u7D20\u7EA7\u7684\u63A7\u5236\u3002',

    // Header / Footer (index.html)
    'header.skipLink': '\u8DF3\u8F6C\u5230\u4E3B\u8981\u5185\u5BB9',
    'footer.kofi': '\u2615 \u5728 Ko-fi \u4E0A\u652F\u6301\u6211\u4EEC',
    'footer.privacy': '\u4F60\u7684\u56FE\u7247\u6C38\u8FDC\u4E0D\u4F1A\u79BB\u5F00\u4F60\u7684\u8BBE\u5907\u3002\u96F6\u4E0A\u4F20\u3002\u4E0D\u6574\u865A\u7684\u3002',

    // Pipeline error
    'pipeline.error': '\u5904\u7406\u5931\u8D25: {msg}',

    // PWA
    'pwa.install': '[\u5B89\u88C5] \u672C\u5730\u8FD0\u884C',
    'pwa.installed': '\u5DF2\u672C\u5730\u8FD0\u884C',
    'pwa.guideMotivation': '\u2622 \u79BB\u7EBF\u8FD0\u884C\u3002\u53CD\u5E94\u5806\u88C5\u8FDB\u4F60\u7684\u8BBE\u5907\u3002',
    'pwa.guideFirefox': '1. \u70B9\u51FB\u5E95\u90E8\u680F \u22EF\uFF08\u4E09\u4E2A\u70B9\uFF09<br>2. \u70B9\u51FB\u300C\u2026 \u66F4\u591A\u300D<br>3. \u70B9\u51FB\u300C\u6DFB\u52A0\u5E94\u7528\u5230\u4E3B\u5C4F\u5E55\u300D',
    'pwa.guideSafari': '1. \u70B9\u51FB\u5E95\u90E8\u680F\u7684\u5206\u4EAB\u6309\u94AE (\u2B06)<br>2. \u5411\u4E0B\u6ED1 \u2192 \u70B9\u51FB\u300C\u6DFB\u52A0\u5230\u4E3B\u5C4F\u5E55\u300D',
    'pwa.guideGeneric': '1. \u6253\u5F00\u6D4F\u89C8\u5668\u83DC\u5355\uFF08\u22EE \u6216 \u22EF\uFF09<br>2. \u627E\u5230\u300C\u5B89\u88C5\u300D\u6216\u300C\u6DFB\u52A0\u5230\u4E3B\u5C4F\u5E55\u300D',
    'pwa.guideDismiss': '[\u6536\u5230]',

    // Batch mode
    'batch.processing': '\u5904\u7406\u4E2D {current}/{total}',
    'batch.downloadZip': '\u2193 \u4E0B\u8F7D\u5168\u90E8 (ZIP)',
    'batch.failed': '\u5931\u8D25',
    'batch.retry': '\u91CD\u8BD5',
    'batch.discard': '\u4E22\u5F03',
    'batch.backToGrid': '\u2190 \u8FD4\u56DE\u7F51\u683C',
    'batch.limitExceeded': '\u6700\u591A {limit} \u5F20\u56FE\u7247\uFF0C\u4EC5\u53D6\u524D {limit} \u5F20',
    'batch.pending': '\u6392\u961F\u4E2D',
    'batch.processingState': '\u5904\u7406\u4E2D...',
    'batch.done': '\u5B8C\u6210',
    'batch.discarded': '\u5DF2\u4E22\u5F03',
    'batch.completed': '{done}/{total} \u5B8C\u6210\uFF0C{failed} \u5931\u8D25',
    'batch.emptyZip': '\u6CA1\u6709\u5DF2\u5904\u7406\u7684\u56FE\u7247\u53EF\u4E0B\u8F7D',
    'batch.cancel': '\u53D6\u6D88\u6279\u91CF',
    'dropzone.multi': '\u62D6\u5165\u6700\u591A 12 \u5F20\u56FE\u7247\u8FDB\u5165\u6279\u91CF\u6A21\u5F0F',

    // Language selector
    'lang.label': '\u8BED\u8A00',
  },
};

const STORAGE_KEY = 'nukebg-locale';
const SUPPORTED_LOCALES = Object.keys(translations);
const DEFAULT_LOCALE = 'en';

/** Detects the browser language with fallback to 'en' */
function detectLocale(): string {
  // First, check for a ?lang= URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const langParam = urlParams.get('lang');
  if (langParam && SUPPORTED_LOCALES.includes(langParam)) {
    return langParam;
  }

  // Second, check localStorage
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LOCALES.includes(stored)) {
    return stored;
  }

  // Third, detect from browser
  const browserLang = navigator.language?.split('-')[0] || DEFAULT_LOCALE;
  if (SUPPORTED_LOCALES.includes(browserLang)) {
    return browserLang;
  }

  return DEFAULT_LOCALE;
}

let currentLocale = detectLocale();

/**
 * Translates a key to the current locale.
 * Supports basic interpolation: t('key', { var: 'value' })
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

/** Changes the active locale */
export function setLocale(locale: string): void {
  if (!SUPPORTED_LOCALES.includes(locale)) return;
  if (locale === currentLocale) return;

  currentLocale = locale;
  localStorage.setItem(STORAGE_KEY, locale);

  // Update html lang attribute
  document.documentElement.lang = locale;

  // Emit event so components re-render
  document.dispatchEvent(new CustomEvent('nukebg:locale-changed', {
    detail: { locale },
  }));
}

/** Gets the active locale */
export function getLocale(): string {
  return currentLocale;
}

/** Gets the list of supported locales */
export function getSupportedLocales(): string[] {
  return [...SUPPORTED_LOCALES];
}
