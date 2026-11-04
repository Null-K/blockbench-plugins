(function() {
    'use strict';

    const SIZE = 320;
    const DEFAULTS = {
        base: '#c87850', light: '#fff1dc', sky: '#b8cfff', ground: '#70605a',
        intensity: 3, ambient: 0.35, azimuth: -40, elevation: 35,
        roughness: 0.55, specular: true, exposure: 0, tonemap: 'aces', stepped: true, steps: 5
    };
    const PRESETS = {
        studio: {light: '#ffffff', sky: '#ffffff', ground: '#808080', intensity: 3, ambient: 0.35, azimuth: -40, elevation: 35},
        daylight: {light: '#fff1dc', sky: '#b8cfff', ground: '#70605a', intensity: 3, ambient: 0.35, azimuth: -40, elevation: 35},
        sunset: {light: '#ffad69', sky: '#9baeff', ground: '#695069', intensity: 3.5, ambient: 0.3, azimuth: -65, elevation: 15},
        cool: {light: '#a9cdff', sky: '#c0caff', ground: '#555d77', intensity: 2.5, ambient: 0.25, azimuth: 45, elevation: 40}
    };

    function normalizeHex(value) {
        if (typeof value !== 'string') return null;
        let hex = value.trim().replace(/^#/, '');
        if (/^[\da-f]{3}$/i.test(hex)) hex = hex.replace(/./g, '$&$&');
        return /^[\da-f]{6}$/i.test(hex) ? '#' + hex.toLowerCase() : null;
    }

    function srgbToLinear(value) {
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }

    function linearToByte(value) {
        value = Math.max(0, Math.min(1, value));
        return Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055));
    }

    function linearColor(hex) {
        return [1, 3, 5].map(i => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
    }

    function rgbToHex(rgb) {
        return '#' + Array.from(rgb).slice(0, 3).map(c => c.toString(16).padStart(2, '0')).join('');
    }

    function luminance(rgb) {
        return srgbToLinear(rgb[0] / 255) * 0.2126 + srgbToLinear(rgb[1] / 255) * 0.7152 + srgbToLinear(rgb[2] / 255) * 0.0722;
    }

    function aces(value) {
        return Math.max(0, Math.min(1, value * (2.51 * value + 0.03) / (value * (2.43 * value + 0.59) + 0.14)));
    }

    function makeLighting(settings) {
        const az = settings.azimuth * Math.PI / 180;
        const el = settings.elevation * Math.PI / 180;
        const light = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
        const length = Math.hypot(light[0], light[1], light[2] + 1);
        return {
            ...settings,
            base: linearColor(settings.base), lightColor: linearColor(settings.light),
            sky: linearColor(settings.sky), ground: linearColor(settings.ground), light,
            half: length > 1e-6 ? [light[0] / length, light[1] / length, (light[2] + 1) / length] : [0, 0, 1],
            alpha2: Math.max(0.05, settings.roughness) ** 4,
            exposureScale: 2 ** settings.exposure
        };
    }

    function shadeNormal(normal, lighting) {
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const nl = Math.max(0, dot(normal, lighting.light));
        const nv = Math.max(1e-5, normal[2]);
        const nh = Math.max(0, dot(normal, lighting.half));
        const vh = Math.max(0, lighting.half[2]);
        const a2 = lighting.alpha2;
        const denominator = nh * nh * (a2 - 1) + 1;
        const distribution = a2 / (Math.PI * denominator * denominator);

        const visibility = 0.5 / Math.max(1e-6,
            nl * Math.sqrt(nv * nv * (1 - a2) + a2) + nv * Math.sqrt(nl * nl * (1 - a2) + a2));
        const fresnel = lighting.specular ? 0.04 + 0.96 * (1 - vh) ** 5 : 0;
        const specular = lighting.specular ? distribution * visibility * fresnel : 0;
        const hemisphere = normal[1] * 0.5 + 0.5;
        return lighting.base.map((base, i) => {
            const ambient = lighting.ambient * base * (lighting.ground[i] * (1 - hemisphere) + lighting.sky[i] * hemisphere);
            const direct = ((1 - fresnel) * base / Math.PI + specular) * lighting.lightColor[i] * lighting.intensity * nl;
            const value = (ambient + direct) * lighting.exposureScale;
            return linearToByte(lighting.tonemap === 'aces' ? aces(value) : value);
        });
    }

    function normalAt(x, y, size) {
        const nx = (x + 0.5 - size / 2) / (size * 0.44);
        const ny = (size / 2 - y - 0.5) / (size * 0.44);
        const radius2 = nx * nx + ny * ny;
        return radius2 < 1 ? [nx, ny, Math.sqrt(1 - radius2)] : null;
    }

    function renderSphere(settings, size = SIZE) {
        const lighting = makeLighting(settings);
        const pixels = new Uint8ClampedArray(size * size * 4);
        const tones = settings.stepped ? new Float32Array(size * size) : null;
        const samples = [];
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const normal = normalAt(x, y, size);
                if (!normal) continue;
                const rgb = shadeNormal(normal, lighting);
                const offset = (y * size + x) * 4;
                pixels.set(rgb, offset);
                pixels[offset + 3] = 255;
                if (tones) tones[y * size + x] = normal[0] * lighting.light[0] + normal[1] * lighting.light[1] + normal[2] * lighting.light[2];
                if (x % 3 === 0 && y % 3 === 0 && normal[2] > 0.2) {
                    samples.push({hex: rgbToHex(rgb), x, y, luma: luminance(rgb), tone: tones?.[y * size + x]});
                }
            }
        }
        samples.sort(settings.stepped ? (a, b) => a.tone - b.tone : (a, b) => a.luma - b.luma);
        const quantiles = settings.stepped
            ? Array.from({length: settings.steps}, (_, i) => i / (settings.steps - 1))
            : [0, 0.12, 0.3, 0.5, 0.7, 0.9, 1];
        let swatches = quantiles.map(q => samples[Math.round(q * (samples.length - 1))]);
        if (settings.stepped) {
            swatches = swatches.filter((sample, i, all) => !i || sample.tone > all[i - 1].tone);
            const thresholds = swatches.slice(1).map((sample, i) => (sample.tone + swatches[i].tone) / 2);
            const sums = swatches.map(() => ({rgb: [0, 0, 0], count: 0}));
            let band = 0;
            for (const sample of samples) {
                while (band < thresholds.length && sample.tone > thresholds[band]) band++;
                const rgb = linearColor(sample.hex);
                rgb.forEach((value, i) => { sums[band].rgb[i] += value; });
                sums[band].count++;
            }
            const colors = sums.map(sum => sum.rgb.map(value => linearToByte(value / sum.count)));
            swatches = swatches.map((sample, i) => ({...sample, hex: rgbToHex(colors[i]), luma: luminance(colors[i])}));

            for (let offset = 0; offset < pixels.length; offset += 4) {
                if (!pixels[offset + 3]) continue;
                let band = 0;
                while (band < thresholds.length && tones[offset / 4] > thresholds[band]) band++;
                pixels.set(colors[band], offset);
            }
            swatches.sort((a, b) => a.luma - b.luma);
            swatches = swatches.filter((sample, i, all) => all.findIndex(other => other.hex === sample.hex) === i);
        }
        return {pixels, swatches};
    }

    let action, cssHandle, dialog, root, frame = 0, result = null;
    let settings = {...DEFAULTS};
    let selectedPoint = {x: SIZE / 2, y: SIZE / 2};
    let selectedHex = DEFAULTS.base;
    let drag = null;

    const CSS = `
        #color_lighting_dialog { z-index: 19; min-height: min(420px, calc(100vh - 40px)); max-width: calc(100vw - 24px); }
        #color_lighting_dialog .dialog_wrapper { display: flex; min-height: 0; overflow: hidden; }
        #color_lighting_dialog .dialog_content { flex: 1; min-width: 0; margin: 0 !important; padding: 0 !important; max-height: none !important; overflow: hidden !important; }
        .cl-lighting { color: var(--color-text); background: var(--color-ui); display: flex; flex-direction: column; height: 100%; min-height: 0; container: cl-workspace / inline-size; font-size: 12px; scrollbar-color: var(--color-border) var(--color-back); }
        .cl-lighting * { box-sizing: border-box; }
        .cl-lighting [hidden] { display: none !important; }
        .cl-lighting .material-icons { font-size: 17px; width: 17px; flex-shrink: 0; }
        .cl-lighting .cl-layout { display: grid; grid-template-columns: minmax(260px, 1fr) 340px; flex: 1; min-height: 0; overflow: hidden; }
        .cl-lighting .cl-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; padding: 16px; }
        .cl-lighting .cl-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .cl-lighting h3, .cl-lighting h4, .cl-lighting p { margin: 0; }
        .cl-lighting h3 { font-size: 14px; font-weight: 600; color: var(--color-light); }
        .cl-lighting h4 { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; color: var(--color-light); margin-bottom: 14px; }
        .cl-lighting .cl-badge { color: var(--color-subtle_text); font: 11px var(--font-code, monospace); border: 1px solid var(--color-border); border-radius: 4px; padding: 3px 7px; white-space: nowrap; }
        .cl-lighting .cl-stage { flex: 1; min-height: 140px; display: flex; align-items: center; justify-content: center; background: var(--color-back); border: 1px solid var(--color-border); border-radius: 8px; container-type: size; padding: 8px; }
        .cl-lighting .cl-preview { position: relative; width: min(100cqw, 100cqh, 440px); aspect-ratio: 1; flex-shrink: 0; }
        .cl-lighting canvas { display: block; width: 100%; height: auto; cursor: crosshair; touch-action: none; }
        .cl-lighting canvas.cl-dragging { cursor: grabbing; }
        .cl-lighting .cl-marker { position: absolute; width: 11px; height: 11px; border: 2px solid white; outline: 1px solid black; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; }
        .cl-lighting .cl-hint { font-size: 11px; color: var(--color-subtle_text); line-height: 1.65; }
        .cl-lighting .cl-gesture { display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; }
        .cl-lighting kbd { padding: 1px 4px; border: 1px solid var(--color-border); border-radius: 3px; background: var(--color-back); font: inherit; }
        .cl-lighting .cl-sidebar { display: flex; min-height: 0; border-left: 1px solid var(--color-border); }
        .cl-lighting .cl-tabs { display: flex; flex-direction: column; flex: 0 0 54px; padding: 8px 4px; gap: 4px; background: var(--color-back); border-right: 1px solid var(--color-border); }
        .cl-lighting .cl-tab { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; width: 100%; min-width: 0; height: 54px; padding: 0; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--color-subtle_text); font-size: 10px; cursor: pointer; }
        .cl-lighting .cl-tab[aria-selected=true] { background: var(--color-selected); color: var(--color-light); }
        .cl-lighting .cl-tab[aria-selected=true]::before { content: ''; position: absolute; left: 0; top: 50%; width: 4px; height: 24px; transform: translateY(-50%); border-radius: 0 2px 2px 0; background: var(--color-accent); pointer-events: none; }
        .cl-lighting .cl-panes { min-width: 0; flex: 1; padding: 12px; overflow: auto; }
        .cl-lighting .cl-panes, .cl-lighting .cl-layout, .cl-lighting .cl-swatches { scrollbar-width: thin; }
        .cl-lighting .cl-card { padding: 14px 12px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-back); margin-bottom: 12px; }
        .cl-lighting .cl-card:last-child { margin-bottom: 0; }
        .cl-lighting [data-controls] { display: grid; gap: 12px; }
        .cl-lighting .cl-row { display: grid; grid-template-columns: 74px minmax(0, 1fr) 54px; gap: 7px; align-items: center; min-width: 0; }
        .cl-lighting .cl-check { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; }
        .cl-lighting input, .cl-lighting select, .cl-lighting button { font-family: inherit; }
        .cl-lighting input[type=range] { width: 100%; min-width: 0; accent-color: var(--color-accent); margin: 0; }
        .cl-lighting input[type=checkbox] { accent-color: var(--color-accent); cursor: pointer; }
        .cl-lighting input[type=color] { width: 32px; height: 30px; padding: 1px; cursor: pointer; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-ui); }
        .cl-lighting input[type=text], .cl-lighting input[type=number], .cl-lighting select { width: 100%; min-width: 0; height: 30px; padding: 4px 6px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-ui); color: var(--color-text); font-size: 12px; }
        .cl-lighting input[type=number] { padding: 3px; font: 11px var(--font-code, monospace); }
        .cl-lighting .cl-color { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 7px; grid-column: 2 / 4; }
        .cl-lighting .cl-color input[type=text] { font-family: var(--font-code, monospace); }
        .cl-lighting input[aria-invalid=true] { outline: 1px solid var(--color-error); }
        .cl-lighting select { grid-column: 2 / 4; width: 100%; }
        .cl-lighting input:disabled { opacity: 0.4; cursor: not-allowed; }
        .cl-lighting .cl-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 5px 10px; border: 1px solid var(--color-border); border-radius: 5px; background: var(--color-button); color: var(--color-text); cursor: pointer; font-size: 12px; white-space: nowrap; }
        .cl-lighting .cl-btn:hover, .cl-lighting .cl-tab:hover { background: var(--color-selected); }
        .cl-lighting .cl-btn-primary { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-accent_text); }
        .cl-lighting .cl-btn-primary:hover { filter: brightness(1.08); background: var(--color-accent); }
        .cl-lighting .cl-wide { width: 100%; }
        .cl-lighting .cl-actions { display: flex; flex-wrap: wrap; gap: 6px; }
        .cl-lighting .cl-selected { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 10px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-back); }
        .cl-lighting .cl-chip { width: 42px; height: 42px; border: 1px solid var(--color-border); border-radius: 5px; flex-shrink: 0; }
        .cl-lighting .cl-color-info { flex: 1; min-width: 120px; }
        .cl-lighting input.cl-hex { height: 24px; width: 96px; padding: 0; background: transparent; color: var(--color-text); border: none; font: 600 15px var(--font-code, monospace); }
        .cl-lighting .cl-rgb { display: block; font: 10px var(--font-code, monospace); color: var(--color-subtle_text); margin-top: 3px; }
        .cl-lighting .cl-palette { flex-shrink: 0; }
        .cl-lighting .cl-palette .cl-heading { margin-bottom: 8px; }
        .cl-lighting .cl-palette h3 { font-size: 12px; }
        .cl-lighting .cl-swatches { display: grid; grid-template-columns: repeat(auto-fit, minmax(55px, 1fr)); gap: 5px; max-height: 150px; overflow: auto; padding: 3px; margin: -3px; }
        .cl-lighting .cl-swatches button { height: auto; min-width: 0; padding: 0; background: var(--color-back); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 4px; overflow: hidden; cursor: pointer; }
        .cl-lighting .cl-swatches button[aria-pressed=true] { outline: 2px solid var(--color-accent); outline-offset: 1px; }
        .cl-lighting .cl-swatch-fill { display: block; height: 30px; }
        .cl-lighting .cl-swatch-label { display: block; font: 10px var(--font-code, monospace); padding: 5px 0; }
        .cl-lighting .cl-palette-actions { margin-top: 10px; }
        .cl-lighting .cl-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 9px 12px; border-top: 1px solid var(--color-border); flex-shrink: 0; }
        .cl-lighting button:focus-visible, .cl-lighting canvas:focus-visible, .cl-lighting input:focus-visible, .cl-lighting select:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
        @container cl-workspace (max-width: 700px) {
            .cl-lighting .cl-layout { grid-template-columns: 1fr; grid-template-rows: 570px max-content; align-content: start; overflow-y: auto; }
            .cl-lighting .cl-main { min-height: 570px; }
            .cl-lighting .cl-sidebar { min-height: 340px; border-left: none; border-top: 1px solid var(--color-border); }
            .cl-lighting .cl-panes { overflow: visible; }
        }
    `;

    function message(text) {
        Blockbench.showQuickMessage(text, 2500);
    }

    function selectPoint(x, y) {
        if (!result || !root) return;
        x = Math.max(0, Math.min(SIZE - 1, Math.floor(x)));
        y = Math.max(0, Math.min(SIZE - 1, Math.floor(y)));
        const offset = (y * SIZE + x) * 4;
        if (!result.pixels[offset + 3]) return;
        selectedPoint = {x, y};
        selectedHex = rgbToHex(result.pixels.subarray(offset, offset + 3));
        root.querySelector('.cl-chip').style.backgroundColor = selectedHex;
        root.querySelector('.cl-hex').value = selectedHex;
        root.querySelector('.cl-rgb').textContent = 'RGB ' + Array.from(result.pixels.subarray(offset, offset + 3)).join(', ');
        const marker = root.querySelector('.cl-marker');
        marker.style.left = (x + 0.5) / SIZE * 100 + '%';
        marker.style.top = (y + 0.5) / SIZE * 100 + '%';
        root.querySelectorAll('.cl-swatches button').forEach(button => {
            button.setAttribute('aria-pressed', String(result.swatches[Number(button.dataset.swatch)].hex === selectedHex));
        });
    }

    function draw() {
        frame = 0;
        if (!root) return;
        result = renderSphere(settings);
        const canvas = root.querySelector('canvas');
        canvas.style.imageRendering = settings.stepped ? 'pixelated' : 'auto';
        root.querySelectorAll('[data-setting=steps]').forEach(input => { input.disabled = !settings.stepped; });
        root.querySelector('.cl-mode').textContent = settings.stepped ? `阶梯 #${result.swatches.length} 色` : '平滑预览';
        root.querySelector('.cl-count').textContent = `共 ${result.swatches.length} 色 (暗 → 亮)`;
        const ctx = canvas.getContext('2d');
        const image = ctx.createImageData(SIZE, SIZE);
        image.data.set(result.pixels);
        ctx.putImageData(image, 0, 0);
        const swatches = root.querySelector('.cl-swatches');
        if (swatches.children.length !== result.swatches.length) {
            swatches.innerHTML = result.swatches.map((_, i) => `<button type="button" data-swatch="${i}"><span class="cl-swatch-fill"></span><span class="cl-swatch-label"></span></button>`).join('');
        }
        const labels = ['最暗', '暗部', '暗部过渡', '中间调', '亮部过渡', '亮部', '最亮'];
        root.querySelectorAll('.cl-swatches button').forEach((button, i) => {
            const color = result.swatches[i].hex;
            button.querySelector('.cl-swatch-fill').style.backgroundColor = color;
            button.querySelector('.cl-swatch-label').textContent = color;
            button.title = (settings.stepped ? `色阶 ${i + 1}/${result.swatches.length}` : labels[i]) + ' ' + color;
            button.setAttribute('aria-label', button.title);
        });
        selectPoint(selectedPoint.x, selectedPoint.y);
    }

    function scheduleDraw() {
        if (!frame) frame = requestAnimationFrame(draw);
    }

    function flushDraw() {
        if (frame) {
            cancelAnimationFrame(frame);
            draw();
        }
    }

    function syncControls() {
        root.querySelectorAll('[data-setting]').forEach(input => {
            const key = input.dataset.setting;
            if (input.type === 'checkbox') input.checked = settings[key];
            else input.value = settings[key];
            input.removeAttribute('aria-invalid');
            input.setCustomValidity?.('');
        });
    }

    function addColors(colors) {
        if (StateMemory.color_palette_locked) return message('调色板已锁定，请先解锁');
        const known = new Set(ColorPanel.palette.map(c => c.toLowerCase()));
        const added = [];
        colors.forEach(color => {
            if (!known.has(color)) {
                ColorPanel.palette.push(color);
                known.add(color);
                added.push(color);
            }
        });
        try {
            ColorPanel.saveLocalStorages();
            message(added.length ? `已加入 ${added.length} 个颜色` : '颜色已在调色板中');
        } catch (error) {
            console.error('[Color Lighting] 保存调色板失败', error);
            message('颜色已加入，但保存失败；关闭软件后可能丢失');
        }
    }

    async function copyRamp() {
        flushDraw();
        const text = result.swatches.map(s => s.hex).join('\n');
        try {
            if (typeof clipboard !== 'undefined') clipboard.writeText(text);
            else await navigator.clipboard.writeText(text);
            message('已复制 HEX 色阶');
        } catch (error) {
            Blockbench.showMessageBox({title: '请手动复制色阶', message: text});
        }
    }

    function buildWindow() {
        root = document.createElement('div');
        root.className = 'cl-lighting';
        root.innerHTML = `
            <div class="cl-layout">
                <main class="cl-main" aria-label="材质球预览与取色">
                    <div class="cl-heading"><h3>材质球预览</h3><span class="cl-badge cl-mode"></span></div>
                    <div class="cl-stage">
                        <div class="cl-preview">
                            <canvas width="${SIZE}" height="${SIZE}" tabindex="0" role="img" aria-label="光照材质球：单击取色，拖动调整灯光，方向键移动取色点"></canvas>
                            <span class="cl-marker"></span>
                        </div>
                    </div>
                    <p class="cl-hint cl-gesture"><span>单击取色</span><span>拖动调整灯光</span><span><kbd>↑ ↓ ← →</kbd> 微调取色点</span></p>
                    <div class="cl-selected">
                        <span class="cl-chip"></span>
                        <div class="cl-color-info">
                            <input class="cl-hex" readonly aria-label="选中颜色 HEX" title="可选中文字复制">
                            <span class="cl-rgb" aria-live="polite"></span>
                        </div>
                        <div class="cl-actions">
                            <button type="button" class="cl-btn cl-btn-primary" data-action="brush"><span class="material-icons" aria-hidden="true">brush</span>设为画笔色</button>
                            <button type="button" class="cl-btn" data-action="add_selected" title="将选中的颜色加入调色板"><span class="material-icons" aria-hidden="true">add</span>加入调色板</button>
                        </div>
                    </div>
                    <section class="cl-palette" aria-label="光照色阶">
                        <div class="cl-heading"><h3>光照色阶</h3><span class="cl-hint cl-count"></span></div>
                        <div class="cl-swatches"></div>
                        <div class="cl-actions cl-palette-actions">
                            <button type="button" class="cl-btn" data-action="add_ramp"><span class="material-icons" aria-hidden="true">palette</span>整组加入调色板</button>
                            <button type="button" class="cl-btn" data-action="copy_ramp"><span class="material-icons" aria-hidden="true">content_copy</span>复制 HEX 色阶</button>
                        </div>
                    </section>
                </main>
                <aside class="cl-sidebar" aria-label="光照与材质参数">
                    <div class="cl-tabs" role="tablist" aria-label="参数分类" aria-orientation="vertical">
                        <button type="button" class="cl-tab" id="cl-tab-material" role="tab" aria-controls="cl-pane-material" aria-selected="true" tabindex="0" title="材质与色阶"><span class="material-icons" aria-hidden="true">palette</span>材质</button>
                        <button type="button" class="cl-tab" id="cl-tab-light" role="tab" aria-controls="cl-pane-light" aria-selected="false" tabindex="-1" title="灯光与环境"><span class="material-icons" aria-hidden="true">light_mode</span>灯光</button>
                        <button type="button" class="cl-tab" id="cl-tab-display" role="tab" aria-controls="cl-pane-display" aria-selected="false" tabindex="-1" title="显示与操作说明"><span class="material-icons" aria-hidden="true">tune</span>显示</button>
                    </div>
                    <div class="cl-panes">
                        <section id="cl-pane-material" role="tabpanel" aria-labelledby="cl-tab-material">
                            <div class="cl-card"><h4><span class="material-icons" aria-hidden="true">color_lens</span>表面颜色</h4>
                                <div data-controls="base"></div>
                                <button type="button" class="cl-btn cl-wide" data-action="use_base" style="margin-top:12px" title="将当前 Blockbench 画笔色作为底色"><span class="material-icons" aria-hidden="true">colorize</span>读取当前画笔底色</button>
                            </div>
                            <div class="cl-card"><h4><span class="material-icons" aria-hidden="true">grid_on</span>像素画色阶</h4>
                                <div data-controls="steps"><label class="cl-check"><span>阶梯渐变</span><input type="checkbox" data-setting="stepped"></label></div>
                            </div>
                            <div class="cl-card"><h4><span class="material-icons" aria-hidden="true">auto_awesome</span>表面质感</h4>
                                <div data-controls="surface"><label class="cl-check"><span>表面高光</span><input type="checkbox" data-setting="specular"></label></div>
                            </div>
                        </section>
                        <section id="cl-pane-light" role="tabpanel" aria-labelledby="cl-tab-light" hidden>
                            <div class="cl-card"><h4><span class="material-icons" aria-hidden="true">wb_sunny</span>光照预设</h4>
                                <select data-preset aria-label="光照预设"><option value="">自定义</option><option value="studio">中性影棚</option><option value="daylight">日光 / 冷阴影</option><option value="sunset">暖色夕阳</option><option value="cool">冷色灯光</option></select>
                            </div>
                            <div class="cl-card"><h4><span class="material-icons" aria-hidden="true">light_mode</span>主光源</h4><div data-controls="light"></div>
                            </div>
                            <div class="cl-card"><h4><span class="material-icons" aria-hidden="true">public</span>环境补光</h4><div data-controls="ambient"></div></div>
                        </section>
                        <section id="cl-pane-display" role="tabpanel" aria-labelledby="cl-tab-display" hidden>
                            <div class="cl-card"><h4><span class="material-icons" aria-hidden="true">tune</span>显示映射</h4>
                                <div data-controls="display"><label class="cl-row"><span>色调映射</span><select data-setting="tonemap"><option value="aces">ACES 近似</option><option value="clip">标准 sRGB</option></select></label></div>
                            </div>
                        </section>
                    </div>
                </aside>
            </div>
            <footer class="cl-footer">
                <button type="button" class="cl-btn" data-action="reset" title="保留底色，重置其余光照与材质参数"><span class="material-icons" aria-hidden="true">restart_alt</span>重置参数</button>
                <button type="button" class="cl-btn" data-action="close">关闭</button>
            </footer>
        `;
        [['base', '底色', 'base'], ['light', '颜色', 'light'], ['sky', '天空颜色', 'ambient'], ['ground', '地面颜色', 'ambient']].forEach(([key, label, group]) => {
            const row = document.createElement('div');
            row.className = 'cl-row';
            row.innerHTML = `<label for="cl-${key}">${label}</label><div class="cl-color">
                <input id="cl-${key}" type="color" data-setting="${key}" aria-label="${label}">
                <input type="text" data-setting="${key}" aria-label="${label} HEX" maxlength="7" spellcheck="false">
            </div>`;
            root.querySelector(`[data-controls="${group}"]`).append(row);
        });
        [
            ['steps', '色阶档数', 2, 16, 1, 'steps'],
            ['intensity', '主光强度', 0, 8, 0.05, 'light'], ['ambient', '环境强度', 0, 2, 0.01, 'ambient'],
            ['azimuth', '水平角 °', -180, 180, 1, 'light'], ['elevation', '仰角 °', -80, 80, 1, 'light'],
            ['roughness', '粗糙度', 0.05, 1, 0.01, 'surface'], ['exposure', '曝光 EV', -3, 3, 0.1, 'display']
        ].forEach(([key, label, min, max, step, group]) => {
            const row = document.createElement('div');
            row.className = 'cl-row';
            row.innerHTML = `<label for="cl-${key}">${label}</label><input id="cl-${key}" type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" aria-label="${label}"><input type="number" data-setting="${key}" min="${min}" max="${max}" step="${step}" aria-label="${label} 数值">`;
            root.querySelector(`[data-controls="${group}"]`).append(row);
        });
        const tabs = Array.from(root.querySelectorAll('[role=tab]'));
        function activateTab(tab) {
            tabs.forEach(button => {
                const active = button === tab;
                button.setAttribute('aria-selected', String(active));
                button.tabIndex = active ? 0 : -1;
                root.querySelector('#' + button.getAttribute('aria-controls')).hidden = !active;
            });
        }
        tabs.forEach((tab, i) => {
            tab.addEventListener('click', () => activateTab(tab));
            tab.addEventListener('keydown', event => {
                let index;
                if (event.key === 'ArrowDown' || event.key === 'ArrowRight') index = (i + 1) % tabs.length;
                else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') index = (i + tabs.length - 1) % tabs.length;
                else if (event.key === 'Home') index = 0;
                else if (event.key === 'End') index = tabs.length - 1;
                else return;
                event.preventDefault();
                event.stopPropagation();
                activateTab(tabs[index]);
                tabs[index].focus();
            });
        });
        root.addEventListener('input', event => {
            const input = event.target;
            const key = input.dataset.setting;
            if (!key) return;
            let value;
            if (input.type === 'color' || input.type === 'text') {
                value = normalizeHex(input.value);
                input.setAttribute('aria-invalid', String(!value));
                input.setCustomValidity(value ? '' : '请输入 #RGB 或 #RRGGBB 颜色');
                if (!value) return;
            } else if (input.type === 'range' || input.type === 'number') {
                value = input.valueAsNumber;
                const valid = Number.isFinite(value) && input.validity.valid;
                input.setAttribute('aria-invalid', String(!valid));
                if (!valid) return;
            } else if (input.type === 'checkbox') value = input.checked;
            else {
                if (!['aces', 'clip'].includes(input.value)) return;
                value = input.value;
            }
            settings[key] = value;

            root.querySelectorAll(`[data-setting="${key}"]`).forEach(peer => {
                if (peer !== input) {
                    peer.value = value;
                    peer.removeAttribute('aria-invalid');
                    peer.setCustomValidity?.('');
                }
            });
            if (key in PRESETS.daylight) root.querySelector('[data-preset]').value = '';
            scheduleDraw();
        });
        root.addEventListener('change', event => {
            if (event.target.matches('input[type=text][data-setting], input[type=number][data-setting]')) syncControls();
            if (event.target.hasAttribute('data-preset') && PRESETS[event.target.value]) {
                Object.assign(settings, PRESETS[event.target.value]);
                syncControls();
                scheduleDraw();
            }
        });
        root.addEventListener('keydown', event => {
            if (event.key !== 'Escape' && event.target.matches('input, select, button')) event.stopPropagation();
        });
        root.addEventListener('click', event => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            flushDraw();
            switch (button.dataset.action) {
                case 'close': dialog.close(); break;
                case 'brush': ColorPanel.set(selectedHex); message('已设为画笔色 ' + selectedHex); break;
                case 'add_selected': addColors([selectedHex]); break;
                case 'add_ramp': addColors(result.swatches.map(s => s.hex)); break;
                case 'copy_ramp': copyRamp(); break;
                case 'use_base': {
                    const color = normalizeHex(ColorPanel.get());
                    if (!color) return message('当前画笔色不是有效的 HEX 颜色');
                    settings.base = color;
                    syncControls();
                    scheduleDraw();
                    break;
                }
                case 'reset':
                    settings = {...DEFAULTS, base: settings.base};
                    root.querySelector('[data-preset]').value = '';
                    syncControls();
                    scheduleDraw();
                    break;
            }
        });
        root.querySelector('.cl-swatches').addEventListener('click', event => {
            const button = event.target.closest('button[data-swatch]');
            if (!button) return;
            flushDraw();
            const swatch = result.swatches[Math.min(Number(button.dataset.swatch), result.swatches.length - 1)];
            selectPoint(swatch.x, swatch.y);
        });
        const canvas = root.querySelector('canvas');
        canvas.addEventListener('pointerdown', event => {
            if (event.button !== 0 || drag) return;
            canvas.focus();
            canvas.setPointerCapture(event.pointerId);
            drag = {id: event.pointerId, x: event.clientX, y: event.clientY, azimuth: settings.azimuth, elevation: settings.elevation, moved: false};
        });
        canvas.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.id) return;
            const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) < 4) return;
            drag.moved = true;
            canvas.classList.add('cl-dragging');
            settings.azimuth = Math.round(((drag.azimuth + dx * 0.7 + 180) % 360 + 360) % 360 - 180);
            settings.elevation = Math.round(Math.max(-80, Math.min(80, drag.elevation - dy * 0.5)));
            root.querySelector('[data-preset]').value = '';
            syncControls();
            scheduleDraw();
        });
        canvas.addEventListener('pointerup', event => {
            if (!drag || event.pointerId !== drag.id) return;
            if (!drag.moved) {
                flushDraw();
                const bounds = canvas.getBoundingClientRect();
                selectPoint((event.clientX - bounds.left) / bounds.width * SIZE, (event.clientY - bounds.top) / bounds.height * SIZE);
            }
            drag = null;
            canvas.classList.remove('cl-dragging');
            canvas.releasePointerCapture(event.pointerId);
        });
        canvas.addEventListener('lostpointercapture', () => { drag = null; canvas.classList.remove('cl-dragging'); });
        canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('cl-dragging'); });
        canvas.addEventListener('keydown', event => {
            const movement = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key];
            if (!movement) return;
            event.preventDefault();
            event.stopPropagation();
            flushDraw();
            selectPoint(selectedPoint.x + movement[0], selectedPoint.y + movement[1]);
        });
        syncControls();
        return root;
    }

    function closeWindow() {
        cancelAnimationFrame(frame);
        frame = 0;
        drag = null;
        root?.querySelector('canvas').classList.remove('cl-dragging');
    }

    function openWindow() {
        if (!dialog) {
            settings.base = normalizeHex(ColorPanel.get()) || DEFAULTS.base;
            dialog = new Dialog('color_lighting_dialog', {
                title: '光影调色台', width: 960, resizable: true, darken: false, cancel_on_click_outside: false,
                lines: [buildWindow()], buttons: [],
                onBuild() {
                    this.object.style.height = Math.round(Math.min(720, window.innerHeight - 40)) + 'px';
                    this.object.addEventListener('keydown', event => {
                        event.stopPropagation();
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            this.close();
                        }
                    });
                },
                onOpen() { syncControls(); scheduleDraw(); },
                onCancel: closeWindow,
                onConfirm: closeWindow
            });

            dialog.focus = function() { return this; };
            dialog.hide = function() {
                closeWindow();
                this.object.remove();
                return this;
            };
        }
        dialog.show();
    }

    if (globalThis.__COLOR_LIGHTING_TEST__) {
        globalThis.__COLOR_LIGHTING_INTERNALS__ = {normalizeHex, srgbToLinear, linearToByte, makeLighting, shadeNormal, normalAt, renderSphere, DEFAULTS};
    }

    BBPlugin.register('light_shade_studio', {
        title: '光影调色台', author: 'PuddingKC', icon: 'light_mode',
        description: '选择底色，在独立材质球上预览彩色光照，提取阴影、过渡与亮部颜色',
        about: [
			'在 **工具 → 光影调色台** 中打开',
			'',
            '- 左键按住拖拽球面调整光照方向',
            '- 左键单击球面选择取色位置',
            '',
			'官方更新地址：https://github.com/Null-K/blockbench-plugins'
		].join('\n'),
        version: '1.2.1', min_version: '4.8.0', variant: 'both', tags: ['Painting', 'Preview'],
        onload() {
            cssHandle = Blockbench.addCSS(CSS);
            action = new Action('color_lighting_open', {name: '光影调色台', icon: 'light_mode', click: openWindow});
            MenuBar.addAction(action, 'tools');
        },
        onunload() {
            closeWindow();
            dialog?.delete();
            action?.delete();
            cssHandle?.delete();
            dialog = root = result = action = cssHandle = null;
        }
    });
})();
