// Records a short test-pattern WebM in headless Chromium for the sample data (no ffmpeg needed).
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const secs = parseInt(process.env.SECS || '40', 10);
  const b64 = await page.evaluate(async (secs) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    const stream = c.captureStream(25);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 400000 });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const start = performance.now();
    let raf;
    (function frame() {
      const t = (performance.now() - start) / 1000;
      g.fillStyle = `hsl(${(t * 40) % 360},60%,35%)`; g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center';
      g.fillText('Patreon TV test ' + t.toFixed(1) + 's', 320, 200);
      raf = requestAnimationFrame(frame);
    })();
    rec.start(500);
    await new Promise((r) => setTimeout(r, secs * 1000));
    rec.stop(); cancelAnimationFrame(raf);
    await new Promise((r) => (rec.onstop = r));
    const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
    let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }, secs);
  fs.writeFileSync(process.argv[2], Buffer.from(b64, 'base64'));
  await browser.close();
})();
