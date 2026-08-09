import { emit } from './lib/event-bus';

/** Deferred install prompt captured from beforeinstallprompt */
let deferredPrompt: BeforeInstallPromptEvent | null = null;

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  prompt(): Promise<void>;
}

/** Trigger the deferred PWA install prompt */
export async function installApp(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome === 'accepted';
}

/** Check if the app is running in standalone (installed) mode */
export function isAppInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        // Update detection: when a new SW is waiting, notify the app
        const onUpdateFound = (): void => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              emit(document, 'nukebg:sw-update-available', undefined);
            }
          });
        };

        // Check if there's already a waiting worker
        if (registration.waiting && navigator.serviceWorker.controller) {
          emit(document, 'nukebg:sw-update-available', undefined);
        }

        registration.addEventListener('updatefound', onUpdateFound);
      })
      .catch((err) => {
        console.warn('Service Worker registration failed:', err);
      });
  });

  // Capture the deferred install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    emit(document, 'nukebg:pwa-installable', undefined);
  });
}
