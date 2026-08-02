const { getLanguageOptions } = require('./languages');

function generateLandingHTML(manifest, baseUrl) {
  const languageOptions = getLanguageOptions();
  const optionsHTML = languageOptions
    .map(opt => `<option value="${opt}">${opt}</option>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${manifest.name}</title>
  <link rel="icon" type="image/png" href="${manifest.logo}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background-color: #09090b;
      color: #f4f4f5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .wrapper {
      width: 100%;
      max-width: 860px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2rem;
    }
    header {
      text-align: center;
      position: relative;
      width: 100%;
    }
    h1 {
      font-size: 2.5rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      color: #ffffff;
    }
    h1 span { color: #3b82f6; }
    .tagline {
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: #71717a;
      margin-top: 0.5rem;
    }
    .card {
      width: 100%;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      overflow: hidden;
    }
    .card-header {
      background: #141417;
      border-bottom: 1px solid #27272a;
      padding: 0.75rem 1.25rem;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #a1a1aa;
    }
    .card-body {
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1rem;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    label {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #a1a1aa;
    }
    select {
      width: 100%;
      background: #09090b;
      border: 1px solid #27272a;
      color: #f4f4f5;
      padding: 0.65rem 0.85rem;
      border-radius: 8px;
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.2s;
    }
    select:focus { border-color: #3b82f6; }
    .actions {
      display: flex;
      gap: 1rem;
      margin-top: 0.5rem;
    }
    .btn {
      flex: 1;
      background: #2563eb;
      color: #ffffff;
      font-size: 0.9rem;
      font-weight: 600;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      text-decoration: none;
      border: none;
      cursor: pointer;
      text-align: center;
      transition: background 0.2s;
    }
    .btn:hover { background: #1d4ed8; }
    .btn-copy {
      background: #27272a;
      color: #e4e4e7;
    }
    .btn-copy:hover { background: #3f3f46; }
    @media (max-width: 640px) {
      .actions { flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <header>
      <h1>Dual<span>Subtitles</span></h1>
      <div class="tagline">SCRAPE AND STREAM DUAL SUBTITLES SEAMLESSLY.</div>
    </header>

    <div class="card">
      <div class="card-header">SUBTITLE LANGUAGES</div>
      <div class="card-body">
        <div class="grid">
          <div class="field">
            <label for="mainLang">PRIMARY LANGUAGE (Top)</label>
            <select id="mainLang">${optionsHTML}</select>
          </div>
          <div class="field">
            <label for="transLang">SECONDARY LANGUAGE (Bottom)</label>
            <select id="transLang">${optionsHTML}</select>
          </div>
        </div>

        <div class="card-header" style="margin: 0.5rem -1.25rem 0; border-top: 1px solid #27272a;">STYLE & DISPLAY CUSTOMIZATION</div>

        <div class="grid">
          <div class="field">
            <label for="marker">SECONDARY MARKER PREFIX</label>
            <select id="marker">
              <option value="none" selected>None (No prefix symbol)</option>
              <option value="angle">Angle Symbol (›)</option>
              <option value="dash">Dash (-)</option>
              <option value="dot">Dot (•)</option>
            </select>
          </div>
          <div class="field">
            <label for="primarySize">PRIMARY SUBTITLE SIZE</label>
            <select id="primarySize">
              <option value="normal" selected>Normal</option>
              <option value="large">Large</option>
              <option value="small">Small</option>
            </select>
          </div>
          <div class="field">
            <label for="secondarySize">SECONDARY SUBTITLE SIZE</label>
            <select id="secondarySize">
              <option value="small" selected>Small (Recommended)</option>
              <option value="normal">Normal</option>
              <option value="x-small">Extra Small</option>
            </select>
          </div>
          <div class="field">
            <label for="color">SECONDARY SUBTITLE COLOR</label>
            <select id="color">
              <option value="#94a3b8" selected>Slate Gray (#94a3b8)</option>
              <option value="#fef08a">Soft Yellow (#fef08a)</option>
              <option value="#a5f3fc">Cyan (#a5f3fc)</option>
              <option value="#ffffff">White (#ffffff)</option>
            </select>
          </div>
        </div>

        <div class="actions">
          <a id="installBtn" href="#" class="btn">Install Addon</a>
          <button id="copyBtn" class="btn btn-copy">Copy Manifest Link</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    const baseUrl = (window.location.origin && !window.location.origin.includes('file://'))
      ? window.location.origin
      : "${baseUrl}";
    const mainSelect = document.getElementById('mainLang');
    const transSelect = document.getElementById('transLang');
    const markerSelect = document.getElementById('marker');
    const primarySizeSelect = document.getElementById('primarySize');
    const secondarySizeSelect = document.getElementById('secondarySize');
    const colorSelect = document.getElementById('color');
    const installBtn = document.getElementById('installBtn');
    const copyBtn = document.getElementById('copyBtn');

    mainSelect.value = 'English [eng]';
    transSelect.value = 'Vietnamese [vie]';

    function update() {
      const main = encodeURIComponent(mainSelect.value);
      const trans = encodeURIComponent(transSelect.value);
      const marker = encodeURIComponent(markerSelect.value);
      const primarySize = encodeURIComponent(primarySizeSelect.value);
      const secondarySize = encodeURIComponent(secondarySizeSelect.value);
      const color = encodeURIComponent(colorSelect.value);

      const query = 'mainLang=' + main + '&transLang=' + trans + '&marker=' + marker + '&primarySize=' + primarySize + '&secondarySize=' + secondarySize + '&color=' + color;
      const http = baseUrl + '/' + query + '/manifest.json';
      installBtn.href = http.replace(/^https?:\\/\\//, 'stremio://');
      copyBtn.dataset.url = http;
    }

    [mainSelect, transSelect, markerSelect, primarySizeSelect, secondarySizeSelect, colorSelect].forEach(el => el.addEventListener('change', update));
    update();

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(copyBtn.dataset.url).then(() => {
        copyBtn.innerText = 'Copied!';
        setTimeout(() => copyBtn.innerText = 'Copy Manifest Link', 2000);
      });
    });
  </script>
</body>
</html>`;
}

module.exports = generateLandingHTML;
