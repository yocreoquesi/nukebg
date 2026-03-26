# NukeBG -- Convenciones del Proyecto

## Descripcion

NukeBG es una herramienta web open source para creadores que trabajan con imagenes generadas por IA. Nukea fondos, patrones checkerboard y watermarks. Todo el procesamiento ocurre 100% en el navegador del usuario. Licencia GPL-3.0.

## Comandos

```bash
# Instalar dependencias
npm install

# Servidor de desarrollo (http://localhost:5173)
npm run dev

# Ejecutar tests (Vitest, una vez)
npm test

# Tests en modo watch
npm run test:watch

# Build de produccion (tsc + vite build -> dist/)
npm run build

# Preview del build de produccion
npm run preview
```

## Estructura de directorios

```
nukebg/
├── index.html                     # Entry point HTML
├── package.json                   # Dependencias y scripts (nombre: nukebg)
├── tsconfig.json                  # Config TypeScript (strict)
├── vite.config.ts                 # Config Vite
│
├── src/
│   ├── main.ts                    # Bootstrap, registra Web Components
│   ├── sw-register.ts             # Registro del Service Worker
│   ├── components/                # Web Components (ar-app, ar-dropzone, ar-viewer, ar-progress, ar-download, ar-privacy)
│   ├── pipeline/
│   │   ├── orchestrator.ts        # Coordina workers CV y ML (main thread)
│   │   └── constants.ts           # Umbrales y parametros de algoritmos
│   ├── workers/
│   │   ├── cv.worker.ts           # Web Worker de vision clasica
│   │   ├── ml.worker.ts           # Web Worker de ML (Transformers.js + RMBG-1.4)
│   │   └── cv/                    # Modulos de algoritmos CV individuales
│   │       ├── detect-bg-colors.ts
│   │       ├── detect-checker-grid.ts
│   │       ├── grid-flood-fill.ts
│   │       ├── subject-exclusion.ts
│   │       ├── simple-flood-fill.ts
│   │       ├── watermark-detect.ts
│   │       ├── shadow-cleanup.ts
│   │       ├── alpha-refine.ts
│   │       └── utils.ts
│   ├── types/                     # Tipos compartidos (pipeline, image, worker-messages)
│   ├── utils/                     # I/O de imagenes, helpers de canvas
│   └── styles/                    # CSS / Tailwind
│
├── tests/                         # Tests (Vitest + happy-dom)
├── docs/                          # PRD, arquitectura, SEO, ADRs
├── public/                        # Assets estaticos (favicon, manifest, og-image, robots.txt)
└── dist/                          # Output de produccion (generado por build)
```

## Convenciones de idioma

- **Codigo** (variables, funciones, clases, interfaces): **ingles**
- **Comentarios** en el codigo: **espanol**
- **Documentacion publica** (README.md): **ingles**
- **Documentacion interna** (CONTRIBUTING.md, docs/, CLAUDE.md): **espanol**
- **Commits**: descripcion en **espanol**

## Convenciones de commits

Formato: `tipo: descripcion`

Tipos validos: `feat`, `fix`, `docs`, `test`, `refactor`, `infra`, `security`, `design`, `data`, `db`, `review`

Ejemplos:
```
feat: agregar deteccion de watermark DALL-E
fix: corregir flood-fill en bordes de imagen
test: agregar tests para checkerboard de 64px grid
docs: actualizar ARCHITECTURE con nuevo diagrama de secuencia
infra: configurar deploy a Cloudflare Pages
```

## Reglas de desarrollo

### TypeScript
- Modo estricto habilitado. No usar `any`.
- Tipos compartidos en `src/types/`.
- Algoritmos CV como funciones puras: entrada de datos, salida de resultado, sin side effects.

### Parametros
- Todos los numeros magicos y umbrales van en `src/pipeline/constants.ts`.
- No hardcodear valores en los modulos de algoritmos.

### Workers
- Los Web Workers son stateless: reciben `ImageData` via `Transferable`, ejecutan, devuelven resultado.
- El Pipeline Orchestrator vive en el main thread y coordina los workers.

### UI
- Web Components nativos con Shadow DOM. Sin framework.
- Comunicacion entre componentes via Custom Events en `document`.
- WCAG 2.1 AA obligatorio. Soporte de `prefers-reduced-motion`.

### Seguridad
- CSP estricta: no `eval`, no scripts inline.
- SRI en assets de CDN.
- No cookies, no tracking, no analytics.

### Principios
- Privacidad no negociable: todo client-side, imagenes nunca salen del dispositivo.
- Calidad sobre velocidad.
- Offline-capable despues de la primera carga.
- Deployable a hosting estatico (Cloudflare Pages, GitHub Pages, Netlify, Vercel).

## Stack tecnico

- **Runtime**: Vanilla TypeScript + Web Components
- **Build**: Vite 6
- **Tests**: Vitest + happy-dom
- **ML**: Transformers.js con RMBG-1.4 INT8 (~45MB, lazy-loaded)
- **GPU**: WebGPU con fallback automatico a WASM
- **Estilos**: Tailwind CSS
- **Cache**: Service Worker + Cache API
