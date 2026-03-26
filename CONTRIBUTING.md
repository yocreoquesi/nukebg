# Contribuir a NukeBG

Gracias por tu interes en contribuir a NukeBG. Esta guia te ayudara a configurar el entorno, entender la estructura del proyecto, y enviar tus cambios correctamente.

## Tabla de Contenidos

- [Codigo de conducta](#codigo-de-conducta)
- [Clonar y configurar el entorno](#clonar-y-configurar-el-entorno)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Correr tests](#correr-tests)
- [Guia de Pull Requests](#guia-de-pull-requests)
- [Convenciones de commits](#convenciones-de-commits)
- [Code style](#code-style)
- [Areas de contribucion](#areas-de-contribucion)

---

## Codigo de conducta

Se respetuoso, constructivo y colaborativo. Estamos aqui para construir una herramienta util para creadores. No se tolera acoso, discriminacion ni comportamiento toxico.

---

## Clonar y configurar el entorno

### Requisitos previos

- **Node.js** 18 o superior
- **npm** (incluido con Node.js)
- Un navegador moderno (Chrome 113+ recomendado para soporte WebGPU)

### Pasos

```bash
# 1. Haz fork del repositorio en GitHub

# 2. Clona tu fork
git clone https://github.com/TU_USUARIO/nukebg.git
cd nukebg

# 3. Instala dependencias
npm install

# 4. Inicia el servidor de desarrollo
npm run dev
# La app estara disponible en http://localhost:5173

# 5. Verifica que el build funciona
npm run build
```

### Scripts disponibles

| Comando | Descripcion |
|---------|-------------|
| `npm run dev` | Inicia el servidor de desarrollo Vite con HMR |
| `npm run build` | Compila TypeScript y genera el build de produccion |
| `npm run preview` | Preview del build de produccion en local |
| `npm test` | Ejecuta los tests con Vitest (una sola vez) |
| `npm run test:watch` | Ejecuta los tests en modo watch |

---

## Estructura del proyecto

```
nukebg/
├── src/
│   ├── main.ts                    # Entry point, registra Web Components
│   ├── sw-register.ts             # Registro del Service Worker
│   ├── components/                # Web Components
│   │   ├── ar-app.ts              # Componente raiz de la aplicacion
│   │   ├── ar-dropzone.ts         # Zona de drag-and-drop para subir imagenes
│   │   ├── ar-viewer.ts           # Visor before/after con slider
│   │   ├── ar-progress.ts         # Indicador de progreso del pipeline
│   │   ├── ar-download.ts         # Boton de descarga del resultado
│   │   └── ar-privacy.ts          # Aviso de privacidad
│   ├── pipeline/
│   │   ├── orchestrator.ts        # Coordina los workers CV y ML
│   │   └── constants.ts           # Umbrales y parametros de los algoritmos
│   ├── workers/
│   │   ├── cv.worker.ts           # Worker de vision clasica (algoritmos CV)
│   │   ├── ml.worker.ts           # Worker de ML (Transformers.js + RMBG-1.4)
│   │   └── cv/                    # Modulos individuales de algoritmos CV
│   │       ├── detect-bg-colors.ts    # Deteccion de color de fondo por esquinas
│   │       ├── detect-checker-grid.ts # Deteccion de patron checkerboard
│   │       ├── grid-flood-fill.ts     # Flood-fill consciente del grid
│   │       ├── subject-exclusion.ts   # Exclusion de sujeto por celdas
│   │       ├── simple-flood-fill.ts   # Flood-fill simple desde bordes
│   │       ├── watermark-detect.ts    # Deteccion de watermark Gemini
│   │       ├── shadow-cleanup.ts      # Limpieza de sombras/artefactos
│   │       ├── alpha-refine.ts        # Refinamiento de canal alfa
│   │       └── utils.ts              # Utilidades compartidas de CV
│   ├── types/                     # Definiciones de tipos TypeScript
│   │   ├── index.ts               # Re-export de todos los tipos
│   │   ├── pipeline.ts            # Tipos del pipeline y enums
│   │   ├── image.ts               # Tipos de imagen
│   │   └── worker-messages.ts     # Contratos de mensajes entre workers
│   ├── utils/
│   │   └── image-io.ts            # Carga y exportacion de imagenes
│   └── styles/
│       └── main.css               # Estilos CSS / Tailwind
├── tests/                         # Tests (Vitest)
├── docs/                          # Documentacion tecnica (PRD, arquitectura, SEO)
├── public/                        # Assets estaticos (favicon, manifest, og-image)
└── dist/                          # Output del build de produccion
```

### Conceptos clave

- **Pipeline Orchestrator**: vive en el main thread, despacha trabajo a los Web Workers.
- **CV Worker**: ejecuta algoritmos clasicos (checkerboard, flood-fill, watermark, sombras, alfa).
- **ML Worker**: ejecuta inferencia con RMBG-1.4 via Transformers.js. Se carga solo cuando es necesario.
- **Web Components**: manejan la UI con Shadow DOM y Custom Events para comunicacion entre componentes.
- La comunicacion main thread <-> workers usa `postMessage` con objetos `Transferable` (`ImageData`) para cero-copia.

---

## Correr tests

```bash
# Ejecutar todos los tests una vez
npm test

# Ejecutar tests en modo watch (re-ejecuta al guardar cambios)
npm run test:watch
```

Los tests usan **Vitest** con **happy-dom** como entorno de navegador simulado.

### Escribir tests

- Los tests van en el directorio `tests/`.
- Cada modulo de algoritmo CV deberia tener tests unitarios que validen su comportamiento con datos de imagen sinteticos o de referencia.
- Los tests de componentes Web verifican que los Custom Elements se registran y emiten los eventos correctos.

---

## Guia de Pull Requests

### Antes de empezar

1. Abre un **issue** primero si tu cambio es significativo (nueva feature, refactor grande). Esto permite discutir el enfoque antes de invertir tiempo.
2. Crea una **rama** desde `main` con un nombre descriptivo: `feat/batch-processing`, `fix/checker-grid-edge-case`, etc.

### Proceso

1. Haz tus cambios en tu rama.
2. Asegurate de que el build pasa: `npm run build`.
3. Asegurate de que los tests pasan: `npm test`.
4. Prueba manualmente en al menos Chrome y Firefox.
5. Haz commit siguiendo las [convenciones](#convenciones-de-commits).
6. Abre un Pull Request contra `main`.

### Reglas de PRs

- **Un PR, un proposito.** Mantene los PRs enfocados en un solo cambio.
- **Describe que y por que** en la descripcion del PR. Enlaza al issue relacionado.
- **No rompas el modo offline.** Verifica que el Service Worker siga funcionando.
- **No agregues procesamiento server-side.** NukeBG es 100% client-side. Esto no es negociable.
- **No agregues tracking ni analytics.** La privacidad es un valor central.
- **No agregues dependencias externas** sin discutirlo primero en un issue.

### Checklist del PR

- [ ] El codigo compila sin errores (`npm run build`)
- [ ] Los tests pasan (`npm test`)
- [ ] Los cambios funcionan en Chrome (WebGPU) y Firefox (WASM fallback)
- [ ] No hay numeros magicos hardcodeados (usa `constants.ts`)
- [ ] Los commits siguen la convencion

---

## Convenciones de commits

Usamos commits convencionales con descripcion en espanol:

```
tipo: descripcion breve del cambio
```

### Tipos

| Tipo | Cuando usarlo |
|------|---------------|
| `feat` | Nueva funcionalidad |
| `fix` | Correccion de bug |
| `docs` | Cambios en documentacion |
| `test` | Agregar o corregir tests |
| `refactor` | Refactorizacion sin cambio de comportamiento |
| `infra` | Build, CI/CD, deployment |
| `security` | Cambios relacionados con seguridad |
| `design` | Cambios de UI/UX |

### Ejemplos

```
feat: agregar deteccion de watermark DALL-E
fix: corregir flood-fill en bordes de imagen
docs: actualizar README con nuevos screenshots
test: agregar tests para checkerboard de 64px grid
refactor: extraer logica BFS a modulo compartido
infra: agregar workflow de CI con GitHub Actions
```

---

## Code style

### Idioma

- **Codigo** (variables, funciones, clases, interfaces): en **ingles**.
- **Comentarios** en el codigo: en **espanol**.
- **Documentacion publica** (README): en **ingles**.
- **Documentacion interna** (CONTRIBUTING, docs/): en **espanol**.

### TypeScript

- Modo estricto (`strict: true` en tsconfig.json).
- No usar `any`. Las definiciones de tipos compartidas estan en `src/types/`.
- Funciones puras para los algoritmos CV: datos de entrada, resultado de salida, sin efectos secundarios.
- No usar `eval` ni scripts inline. La app usa Content Security Policy estricta.

### Componentes

- Web Components nativos con Shadow DOM.
- Sin framework. Sin JSX.
- Comunicacion entre componentes via Custom Events en `document`.

### Accesibilidad

- Cumplimiento WCAG 2.1 AA.
- Navegacion por teclado en todos los controles interactivos.
- Anuncios para screen readers en cambios de estado.
- Respetar `prefers-reduced-motion`.

### Parametros y umbrales

- Todos los numeros magicos de los algoritmos van en `src/pipeline/constants.ts`.
- No hardcodear valores directamente en los modulos de algoritmos.

---

## Areas de contribucion

### Algoritmos CV (vision clasica)

Los modulos viven en `src/workers/cv/`. Cada uno es una funcion pura que opera sobre `ImageData` o `Uint8Array`. Si mejoras un algoritmo, probalo con imagenes reales de multiples generadores (Gemini, DALL-E, Midjourney, Stable Diffusion, Flux).

### Pipeline ML

El worker ML vive en `src/workers/ml.worker.ts`. Usa Transformers.js con RMBG-1.4 INT8. WebGPU es preferido; WASM es el fallback automatico. El modelo se carga bajo demanda.

### Componentes UI

Los componentes estan en `src/components/`. Son Web Components nativos con Shadow DOM. La accesibilidad es obligatoria: navegacion por teclado, screen readers, soporte de `prefers-reduced-motion`.

### Documentacion

La documentacion tecnica vive en `docs/`. Las mejoras a la documentacion son siempre bienvenidas.

### Tests

Mas cobertura de tests es siempre bienvenida. Especialmente tests de los algoritmos CV con imagenes edge-case.

---

Gracias por ayudar a hacer NukeBG mejor para todos los creadores.
