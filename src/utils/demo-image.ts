/**
 * Build a synthetic demo image entirely in the browser so the "try a
 * sample" CTA has zero repo footprint (no PNG to ship, no licence to
 * audit) and still gives first-time visitors an end-to-end result.
 *
 * The composition is deliberately easy for the pipeline:
 *   - a soft grey radial-gradient background (trivially separable)
 *   - a terminal-green radiation trefoil as the subject
 * So the user sees a clean alpha cutout in under a few seconds.
 */
export async function generateDemoFile(): Promise<File> {
  const W = 640;
  const H = 480;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  // Background: radial grey gradient
  const bg = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W / 1.2);
  bg.addColorStop(0, '#3a3a3a');
  bg.addColorStop(1, '#101010');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Trefoil subject in terminal green, centered.
  const cx = W / 2;
  const cy = H / 2;
  ctx.fillStyle = '#00ff41';

  // Center hub
  ctx.beginPath();
  ctx.arc(cx, cy, 28, 0, Math.PI * 2);
  ctx.fill();

  // Three blades at 0°, 120°, 240°
  for (let i = 0; i < 3; i++) {
    const theta = (i * 2 * Math.PI) / 3 - Math.PI / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(theta);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 140, -Math.PI / 6, Math.PI / 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Label below the mark so the demo explains itself
  ctx.fillStyle = '#00ff41';
  ctx.font = 'bold 18px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('NUKEBG DEMO', cx, H - 40);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/png',
    );
  });
  return new File([blob], 'nukebg-demo.png', { type: 'image/png' });
}
