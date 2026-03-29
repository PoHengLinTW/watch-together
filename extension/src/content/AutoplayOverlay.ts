import type { SyncEvent } from '@watchtogether/shared';

const OVERLAY_ATTR = 'data-watchtogether-overlay';

/** Show a click-to-play overlay over a video that was blocked by autoplay policy. */
export function showAutoplayOverlay(video: HTMLVideoElement, event: SyncEvent): void {
  // Prevent duplicate overlays on the same video
  const parent = video.parentElement;
  if (!parent || parent.querySelector(`[${OVERLAY_ATTR}]`)) return;

  const overlay = document.createElement('div');
  overlay.setAttribute(OVERLAY_ATTR, '1');
  overlay.style.cssText = [
    'position:absolute',
    'inset:0',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:rgba(0,0,0,0.6)',
    'cursor:pointer',
    'z-index:9999',
    'border-radius:inherit',
  ].join(';');

  const label = document.createElement('span');
  label.textContent = '▶ Click to play';
  label.style.cssText = [
    'color:white',
    'font-size:18px',
    'font-family:system-ui,sans-serif',
    'font-weight:600',
    'pointer-events:none',
    'user-select:none',
  ].join(';');

  overlay.appendChild(label);

  // Position parent relatively so overlay can be absolute
  const parentPos = getComputedStyle(parent).position;
  if (parentPos === 'static') {
    parent.style.position = 'relative';
  }

  parent.appendChild(overlay);

  overlay.addEventListener('click', () => {
    overlay.remove();
    if (event.action === 'play') {
      video.currentTime = event.currentTime;
    }
    video.play().catch(() => {
      // If play still fails after user gesture, remove the overlay and give up
    });
  }, { once: true });
}
