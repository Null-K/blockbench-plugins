(function () {
    'use strict';

    const FONT_OPTIONS = {
        'sans-serif': 'System Sans-serif',
        'serif': 'Serif',
        'monospace': 'System Monospace',
        'Microsoft YaHei': 'Microsoft YaHei',
        'SimHei': 'SimHei',
        'SimSun': 'SimSun',
        'KaiTi': 'KaiTi',
        'Arial': 'Arial',
        'Times New Roman': 'Times New Roman',
        'custom': '其他已安装字体'
    };
    const CSS = `
        #text_to_cubes_dialog { max-width: calc(100vw - 24px); overflow: hidden; }
        #text_to_cubes_dialog .dialog_wrapper { display: flex; min-height: 0; overflow: hidden; }
        #text_to_cubes_dialog .dialog_content { flex: 1; min-height: 0; margin: 0 !important; padding: 0 !important; max-height: none !important; overflow: hidden !important; }
        .tc-studio { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; color: var(--color-text); background: var(--color-ui); font-size: 12px; }
        .tc-studio * { box-sizing: border-box; }
        .tc-studio [hidden] { display: none !important; }
        .tc-studio .tc-layout { display: grid; grid-template-columns: minmax(0,1fr) 330px; flex: 1; min-height: 0; overflow: hidden; }
        .tc-studio .tc-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; padding: 16px; }
        .tc-studio .tc-head, .tc-studio .tc-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .tc-studio .tc-head h3 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tc-studio h3, .tc-studio h4, .tc-studio p { margin: 0; }
        .tc-studio h3 { color: var(--color-light); font-size: 14px; font-weight: 600; }
        .tc-studio h4 { color: var(--color-light); font-size: 12px; font-weight: 600; }
        .tc-studio .tc-muted { color: var(--color-subtle_text); font-size: 11px; line-height: 1.55; }
        .tc-studio .tc-badge { flex: 0 0 auto; max-width: 45%; padding: 3px 7px; overflow: hidden; border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-subtle_text); font: 11px var(--font-code,monospace); text-overflow: ellipsis; white-space: nowrap; }
        .tc-studio .tc-stage { display: flex; flex: 1; min-height: 170px; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 12px; overflow: hidden; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-back); }
        .tc-studio .tc-preview { display: block; flex: 1 1 auto; width: 100%; height: auto; min-height: 0; object-fit: contain; }
        .tc-studio .tc-status { flex: 0 0 auto; width: 100%; min-height: 18px; color: var(--color-subtle_text); font-size: 11px; }
        .tc-studio .tc-sidebar { min-width: 0; min-height: 0; padding: 12px; overflow: auto; border-left: 1px solid var(--color-border); }
        .tc-studio .tc-card { margin-bottom: 10px; padding: 12px; border: 1px solid var(--color-border); border-radius: 7px; background: var(--color-back); }
        .tc-studio .tc-card:last-child { margin-bottom: 0; }
        .tc-studio .tc-card-head { justify-content: flex-start; margin-bottom: 10px; }
        .tc-studio .tc-controls { display: grid; gap: 9px; }
        .tc-studio label.tc-field { display: grid; gap: 5px; color: var(--color-subtle_text); }
        .tc-studio input, .tc-studio textarea, .tc-studio select, .tc-studio button { font: inherit; }
        .tc-studio input[type=text], .tc-studio input[type=number], .tc-studio select, .tc-studio textarea { width: 100%; min-width: 0; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-ui); color: var(--color-text); }
        .tc-studio textarea { min-height: 78px; resize: vertical; line-height: 1.5; }
        .tc-studio input[type=range], .tc-studio input[type=checkbox] { accent-color: var(--color-accent); }
        .tc-studio .tc-number-row { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 7px; }
        .tc-studio .tc-toggle { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--color-text); }
        .tc-studio .tc-file-row { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 7px; min-width: 0; }
        .tc-studio .tc-file-actions { display: flex; align-items: center; gap: 7px; }
        .tc-studio .tc-clear-font { width: 30px; padding-right: 0; padding-left: 0; }
        .tc-studio .tc-file-name { overflow: hidden; color: var(--color-subtle_text); text-overflow: ellipsis; white-space: nowrap; }
        .tc-studio .tc-btn { display: inline-flex; min-height: 30px; align-items: center; justify-content: center; gap: 6px; padding: 5px 10px; border: 1px solid var(--color-border); border-radius: 5px; background: var(--color-button); color: var(--color-text); cursor: pointer; white-space: nowrap; }
        .tc-studio .tc-btn:hover { background: var(--color-selected); }
        .tc-studio .tc-btn-primary { border-color: var(--color-accent); background: var(--color-accent); color: var(--color-accent_text); }
        .tc-studio .tc-btn-primary:hover { background: var(--color-accent); filter: brightness(1.08); }
        .tc-studio .tc-btn:disabled { cursor: wait; opacity: 0.55; }
        .tc-studio .tc-footer { display: flex; flex-shrink: 0; justify-content: flex-end; gap: 8px; padding: 9px 12px; border-top: 1px solid var(--color-border); }
        .tc-studio button:focus-visible, .tc-studio input:focus-visible, .tc-studio textarea:focus-visible, .tc-studio select:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
        @media (max-width: 760px) { .tc-studio .tc-layout { grid-template-columns: minmax(0,1fr) 300px; } .tc-studio .tc-main { padding: 10px; } .tc-studio .tc-sidebar { padding: 8px; } }
        @media (max-width: 600px) { .tc-studio .tc-layout { grid-template-columns: 1fr; grid-template-rows: minmax(180px,1fr) auto; overflow-y: auto; } .tc-studio .tc-sidebar { overflow: visible; border-top: 1px solid var(--color-border); border-left: 0; } }
    `;
    const MAX_CUBES = 10000;
    const MAX_CONTOUR_EDGES = 40000;
    let action, cssHandle, currentDialog, fontId = 0;

    function validateForm(form) {
        const text = String(form.text || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
        if (!text.trim()) throw new Error('请输入需要生成的文字。');
        if (text.length > 512 || text.split('\n').length > 16) {
            throw new Error('一次最多输入 512 个字符、16 行文字，请分批生成。');
        }
        const size = Number(form.size), depth = Number(form.depth), resolution = Number(form.resolution);
        if (!Number.isFinite(size) || size < 0.1 || size > 256) throw new Error('字号必须在 0.1~256 模型单位之间。');
        if (!Number.isFinite(depth) || depth < 0.01 || depth > 256) throw new Error('厚度必须在 0.01~256 模型单位之间。');
        if (!Number.isInteger(resolution) || resolution < 8 || resolution > 256) throw new Error('轮廓精度必须是 8~256 之间的整数。');
        const family = form.font === 'custom' ? String(form.custom_font || '').trim() : form.font;
        if (!form.font_file && (!family || family.length > 100 || /[\x00-\x1f]/.test(family))) {
            throw new Error('请选择字体，或输入有效的已安装字体名称。');
        }
        const edgeMode = form.edge_mode || 'pixels';
        if (!['smooth', 'pixels'].includes(edgeMode)) throw new Error('请选择有效的边缘模式。');
        const smoothing = Number(form.smoothing ?? 1.5);
        if (!Number.isFinite(smoothing) || smoothing < 0 || smoothing > 4) throw new Error('轮廓平滑强度必须在 0~4 采样像素之间。');
        return {text, size, depth, resolution, family, edgeMode, smoothing, groupCharacters: form.group_characters !== false};
    }

    function rasterizeText(text, family, resolution) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', {willReadFrequently: true});
        if (!ctx) throw new Error('无法创建文字画布。');
        const font = `${resolution}px ${family}`;
        ctx.font = font;
        const lines = text.split('\n');
        const lineHeight = Math.ceil(resolution * 1.25);
        const metrics = lines.map(line => ctx.measureText(line));
        const left = Math.floor(Math.min(0, ...metrics.map(m => -m.actualBoundingBoxLeft)));
        const right = Math.ceil(Math.max(...metrics.map(m => Math.max(m.width, m.actualBoundingBoxRight))));
        const top = Math.floor(Math.min(...metrics.map((m, i) => i * lineHeight - m.actualBoundingBoxAscent)));
        const bottom = Math.ceil(Math.max(...metrics.map((m, i) => i * lineHeight + m.actualBoundingBoxDescent)));
        const width = right - left + 4, height = bottom - top + 4;
        if (!Number.isFinite(width * height) || width > 4096 || height > 4096 || width * height > 4194304) {
            throw new Error('文字画布过大，请降低轮廓精度、缩短文字或分行。');
        }
        canvas.width = width;
        canvas.height = height;
        ctx.font = font;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffffff';
        lines.forEach((line, i) => ctx.fillText(line, 2 - left, 2 - top + i * lineHeight));
        const pixels = ctx.getImageData(0, 0, width, height).data;
        const mask = new Uint8Array(width * height);
        for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] >= 128 ? 1 : 0;
        const areas = Extruder.scanAreas(pixels, width, height, {mode: 'areas', scan_tolerance: 128});
        if (!areas.length) throw new Error('没有可生成的文字轮廓，请检查字体、文字或提高精度。');
        const bounds = {
            left: Math.min(...areas.map(r => r.x)),
            right: Math.max(...areas.map(r => r.x2 + 1)),
            top: Math.min(...areas.map(r => r.y)),
            bottom: Math.max(...areas.map(r => r.y2 + 1))
        };
        return {canvas, areas, bounds, mask, width, height, baseline: {x: 2 - left, y: 2 - top}, lineHeight};
    }

    function makeTextBoxes(raster, options, family, integerSize) {
        if (!options.groupCharacters) return makeBoxes(raster, options, integerSize);
        const ctx = raster.canvas.getContext('2d');
        const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
        const unit = options.size / options.resolution;
        const center = integerSize ? Math.floor((raster.bounds.left + raster.bounds.right) / 2) : (raster.bounds.left + raster.bounds.right) / 2;
        const boxes = [];
        let index = 0;
        options.text.split('\n').forEach((line, row) => {
            for (const part of segmenter.segment(line)) {
                const character = {index: index++, text: part.segment};
                if (!part.segment.trim()) continue;
                const metrics = ctx.measureText(part.segment);
                if (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight <= 0
                    || metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent <= 0) continue;
                const advance = ctx.measureText(line.slice(0, part.index + part.segment.length)).width - metrics.width;
                const glyph = rasterizeText(part.segment, family, options.resolution);
                let dx = raster.baseline.x + advance - glyph.baseline.x;
                let dy = raster.baseline.y + row * raster.lineHeight - glyph.baseline.y;
                if (integerSize) { dx = Math.round(dx); dy = Math.round(dy); }
                character.origin = [
                    ((glyph.bounds.left + glyph.bounds.right) / 2 + dx - center) * unit,
                    (raster.bounds.bottom - glyph.bounds.bottom - dy) * unit,
                    0
                ];

                glyph.bounds = {
                    left: raster.bounds.left - dx, right: raster.bounds.right - dx,
                    top: raster.bounds.top - dy, bottom: raster.bounds.bottom - dy
                };
                for (const box of makeBoxes(glyph, options, integerSize)) {
                    if (boxes.length >= MAX_CUBES) throw new Error(`将生成超过 ${MAX_CUBES} 个方块，请降低轮廓精度或缩短文字。`);
                    box.character = character;
                    boxes.push(box);
                }
            }
        });
        if (!boxes.length) throw new Error('没有可生成的文字轮廓，请检查字体、文字或提高精度。');
        return boxes;
    }

    function makeBoxes(raster, options, integerSize, smooth = options.edgeMode === 'smooth', rotateCubes = Format.rotate_cubes && !Format.rotation_limit && !Format.rotation_snap) {
        const unit = options.size / options.resolution;
        if (integerSize && (!Number.isInteger(unit) || !Number.isInteger(options.depth))) {
            throw new Error('当前格式只支持整数尺寸：字号必须是轮廓精度的整数倍，厚度也必须是整数；或改用自由模型/基岩版实体格式。');
        }
        if (smooth && (!rotateCubes || integerSize)) {
            throw new Error('平滑边缘需要支持旋转方块的非整数尺寸格式，请切换到自由模型或基岩版实体格式，或选择像素方块模式。');
        }
        const {left, right, bottom} = raster.bounds;
        const center = integerSize ? Math.floor((left + right) / 2) : (left + right) / 2;
        const round = n => Math.round(n * 1000000) / 1000000;
        const boxes = [];
        const addBox = box => {
            if (boxes.length >= MAX_CUBES) throw new Error(`将生成超过 ${MAX_CUBES} 个方块，请降低轮廓精度或缩短文字。`);
            boxes.push(box);
        };

        if (!smooth) {
            raster.areas.forEach(rect => addBox({
                from: [(rect.x - center) * unit, (bottom - rect.y2 - 1) * unit, 0].map(round),
                to: [(rect.x2 + 1 - center) * unit, (bottom - rect.y) * unit, options.depth].map(round)
            }));
            return boxes;
        }

        const {mask, width, height} = raster;
        const stride = width + 1;
        const inside = (x, y) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x];
        const edges = [], outgoing = new Map();
        const edge = (x, y, nx, ny, direction) => {
            const from = y * stride + x, to = ny * stride + nx, index = edges.length;
            if (index >= MAX_CONTOUR_EDGES) throw new Error('文字轮廓过于复杂，请降低轮廓精度或分批生成。');
            edges.push({from, to, direction});
            if (!outgoing.has(from)) outgoing.set(from, []);
            outgoing.get(from).push(index);
        };
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (!inside(x, y)) continue;
                if (!inside(x, y - 1)) edge(x, y, x + 1, y, 0);
                if (!inside(x + 1, y)) edge(x + 1, y, x + 1, y + 1, 1);
                if (!inside(x, y + 1)) edge(x + 1, y + 1, x, y + 1, 2);
                if (!inside(x - 1, y)) edge(x, y + 1, x, y, 3);
            }
        }

        const point = key => ({x: key % stride, y: Math.floor(key / stride)});
        const loops = [], used = new Uint8Array(edges.length);
        for (let start = 0; start < edges.length; start++) {
            if (used[start]) continue;
            const startPoint = edges[start].from, loop = [];
            let current = start, closed = false;
            for (let steps = 0; steps <= edges.length; steps++) {
                if (used[current]) break;
                const currentEdge = edges[current];
                used[current] = 1;
                loop.push(point(currentEdge.from));
                if (currentEdge.to === startPoint) { closed = true; break; }
                const candidates = outgoing.get(currentEdge.to) || [];
                const turnOrder = [(currentEdge.direction + 1) % 4, currentEdge.direction, (currentEdge.direction + 3) % 4, (currentEdge.direction + 2) % 4];
                current = turnOrder.flatMap(direction => candidates.filter(i => !used[i] && edges[i].direction === direction))[0];
                if (current === undefined) break;
            }
            if (!closed) throw new Error('文字轮廓未闭合，请降低轮廓精度后重试。');
            if (loop.length >= 4) loops.push(simplifyLoop(loop, smooth ? options.smoothing ?? 1.5 : 0));
        }
        if (!loops.length) throw new Error('无法解析文字轮廓，请降低轮廓精度后重试。');

        for (const part of fillRotatedRegions(loops)) {
            const cx = (part.x - center) * unit, cy = (bottom - part.y) * unit;
            addBox({
                from: [cx - part.length * unit / 2, cy - part.thickness * unit / 2, 0].map(round),
                to: [cx + part.length * unit / 2, cy + part.thickness * unit / 2, options.depth].map(round),
                origin: [round(cx), round(cy), 0],
                rotation: [0, 0, round(-part.angle * 180 / Math.PI)]
            });
        }
        return boxes;
    }

    function simplifyOpen(points, tolerance) {
        const keep = new Uint8Array(points.length);
        keep[0] = keep[points.length - 1] = 1;
        const stack = [[0, points.length - 1]], toleranceSquared = tolerance * tolerance;
        while (stack.length) {
            const [first, last] = stack.pop(), a = points[first], b = points[last];
            const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
            let best = toleranceSquared, index = -1;
            for (let i = first + 1; i < last; i++) {
                const p = points[i];
                const along = lengthSquared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
                const px = p.x - a.x - along * dx, py = p.y - a.y - along * dy;
                const distanceSquared = px * px + py * py;
                if (distanceSquared > best) { best = distanceSquared; index = i; }
            }
            if (index !== -1) {
                keep[index] = 1;
                stack.push([first, index], [index, last]);
            }
        }
        return points.filter((_, i) => keep[i]);
    }

    function polygonArea(points) {
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            area += a.x * b.y - b.x * a.y;
        }
        return area / 2;
    }

    function simplifyLoop(points, tolerance) {
        if (points.length <= 4 || tolerance <= 0) return points;
        const farthestFrom = index => {
            let farthest = index, distance = -1;
            points.forEach((p, i) => {
                const dx = p.x - points[index].x, dy = p.y - points[index].y, next = dx * dx + dy * dy;
                if (next > distance) { distance = next; farthest = i; }
            });
            return farthest;
        };
        const a = farthestFrom(0), b = farthestFrom(a);
        const chain = (from, to) => {
            const result = [points[from]];
            for (let i = (from + 1) % points.length; i !== to; i = (i + 1) % points.length) result.push(points[i]);
            result.push(points[to]);
            return simplifyOpen(result, tolerance);
        };
        const result = chain(a, b).slice(0, -1).concat(chain(b, a).slice(0, -1));
        const area = polygonArea(points), simplifiedArea = polygonArea(result);
        if (result.length < 3 || Math.sign(area) !== Math.sign(simplifiedArea)
            || Math.abs(Math.abs(area) - Math.abs(simplifiedArea)) > Math.abs(area) * 0.08) {
            return tolerance > 0.125 ? simplifyLoop(points, tolerance / 2) : points;
        }
        return result;
    }

    function fillRotatedRegions(loops) {
        const segments = [], rows = new Map(), rowSize = 8;
        for (const loop of loops) {
            loop.forEach((a, i) => {
                const b = loop[(i + 1) % loop.length];
                const segment = {a, b, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x)};
                segments.push(segment);
                for (let row = Math.floor(Math.min(a.y, b.y) / rowSize); row <= Math.floor(Math.max(a.y, b.y) / rowSize); row++) {
                    if (!rows.has(row)) rows.set(row, []);
                    rows.get(row).push(segment);
                }
            });
        }
        const contains = (x, y) => {
            let inside = false;
            for (const {a, b} of rows.get(Math.floor(y / rowSize)) || []) {
                if ((a.y > y) !== (b.y > y) && x < a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
            }
            return inside;
        };
        const crossesInterior = (segment, a, tx, ty, length, thickness) => {
            const local = p => [(p.x - a.x) * tx + (p.y - a.y) * ty, -(p.x - a.x) * ty + (p.y - a.y) * tx];
            const p = local(segment.a), q = local(segment.b);
            let enter = 0, leave = 1;
            for (let axis = 0; axis < 2; axis++) {
                const delta = q[axis] - p[axis], low = 1e-7, high = (axis ? thickness : length) - 1e-7;
                if (Math.abs(delta) < 1e-10) {
                    if (p[axis] <= low || p[axis] >= high) return false;
                } else {
                    const first = (low - p[axis]) / delta, last = (high - p[axis]) / delta;
                    enter = Math.max(enter, Math.min(first, last));
                    leave = Math.min(leave, Math.max(first, last));
                    if (enter >= leave) return false;
                }
            }
            return enter < leave;
        };
        const fits = (a, b, tx, ty, length, thickness) => {
            const nx = -ty * thickness, ny = tx * thickness;
            if (!contains((a.x + b.x + nx) / 2, (a.y + b.y + ny) / 2)) return false;
            const minX = Math.min(a.x, b.x, a.x + nx, b.x + nx), maxX = Math.max(a.x, b.x, a.x + nx, b.x + nx);
            const minY = Math.min(a.y, b.y, a.y + ny, b.y + ny), maxY = Math.max(a.y, b.y, a.y + ny, b.y + ny);
            const checked = new Set();
            for (let row = Math.floor(minY / rowSize); row <= Math.floor(maxY / rowSize); row++) {
                for (const segment of rows.get(row) || []) {
                    if (checked.has(segment) || segment.minX > maxX || segment.maxX < minX) continue;
                    checked.add(segment);
                    if (crossesInterior(segment, a, tx, ty, length, thickness)) return false;
                }
            }
            return true;
        };

        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        segments.forEach(({a}) => {
            left = Math.min(left, a.x); right = Math.max(right, a.x);
            top = Math.min(top, a.y); bottom = Math.max(bottom, a.y);
        });
        const step = (right - left) * (bottom - top) <= 1048576 ? 0.5 : 1;
        const width = Math.ceil((right - left) / step), height = Math.ceil((bottom - top) / step);
        if (width * height > 4194304) throw new Error('文字填充区域过大，请降低轮廓精度或分批生成。');
        const remaining = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            remaining[y * width + x] = contains(left + (x + 0.5) * step, top + (y + 0.5) * step) ? 1 : 0;
        }

        const candidates = [];
        let scanned = 0;
        const addCandidate = rect => {
            if (candidates.length >= 20000) return;
            if (rect.length * rect.thickness < step * step * 4) return;
            const c = Math.cos(rect.angle), s = Math.sin(rect.angle);
            for (const inset of [0, step / 4, step / 2, step]) {
                const length = rect.length - inset * 2, thickness = rect.thickness - inset * 2;
                if (length < step || thickness < step) break;
                const a = {x: rect.x - c * length / 2 + s * thickness / 2, y: rect.y - s * length / 2 - c * thickness / 2};
                const b = {x: a.x + c * length, y: a.y + s * length};
                if (fits(a, b, c, s, length, thickness)) {
                    candidates.push({...rect, length, thickness});
                    return;
                }
            }
        };
        const directionBins = new Map();
        for (const segment of segments) {
            const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y;
            segment.length = Math.hypot(dx, dy);
            segment.angle = Math.atan2(dy, dx);
            const key = ((Math.round(segment.angle * 36 / Math.PI) % 36) + 36) % 36;
            if (!directionBins.has(key)) directionBins.set(key, []);
            directionBins.get(key).push(segment);
        }
        let pairingChecks = 0;
        for (const segment of segments) {
            if (pairingChecks >= 100000) break;
            const tx = Math.cos(segment.angle), ty = Math.sin(segment.angle);
            const opposite = ((Math.round(segment.angle * 36 / Math.PI) % 36) + 36) % 36;
            for (const neighbour of [-1, 0, 1]) for (const other of directionBins.get((opposite + neighbour + 36) % 36) || []) {
                if (++pairingChecks > 100000) break;
                if (other === segment || Math.cos(other.angle - segment.angle) > -0.999) continue;
                const u1 = segment.a.x * tx + segment.a.y * ty, u2 = segment.b.x * tx + segment.b.y * ty;
                const u3 = other.a.x * tx + other.a.y * ty, u4 = other.b.x * tx + other.b.y * ty;
                const minU = Math.max(Math.min(u1, u2), Math.min(u3, u4)), maxU = Math.min(Math.max(u1, u2), Math.max(u3, u4));
                const va = -segment.a.x * ty + segment.a.y * tx;
                const vb = Math.min(-other.a.x * ty + other.a.y * tx, -other.b.x * ty + other.b.y * tx);
                if (maxU - minU < step || vb - va < step) continue;
                const u = (minU + maxU) / 2, v = (va + vb) / 2;
                addCandidate({x: u * tx - v * ty, y: u * ty + v * tx, length: maxU - minU, thickness: vb - va, angle: segment.angle});
            }
        }
        for (const outer of loops.filter(loop => polygonArea(loop) > 0)) {
            const directions = new Map();
            outer.forEach((a, i) => {
                const b = outer[(i + 1) % outer.length], dx = b.x - a.x, dy = b.y - a.y;
                const length = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
                const bucket = ((Math.round(angle * 36 / Math.PI) % 18) + 18) % 18;
                if (!directions.has(bucket)) directions.set(bucket, {weight: 0, longest: 0, angle});
                const entry = directions.get(bucket);
                entry.weight += length;
                if (length > entry.longest) { entry.longest = length; entry.angle = angle; }
            });
            const angles = [0, ...[...directions.values()].sort((a, b) => b.weight - a.weight).slice(0, 4)
                .map(d => ((d.angle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2))];
            const uniqueAngles = angles.filter((angle, i) => !angles.slice(0, i).some(previous => Math.abs(Math.sin(2 * (angle - previous))) < 1e-5));
            for (const angle of uniqueAngles) {
                const c = Math.cos(angle), s = Math.sin(angle);
                const us = outer.map(p => p.x * c + p.y * s), vs = outer.map(p => -p.x * s + p.y * c);
                const u = Math.floor(Math.min(...us) / step) * step, v = Math.floor(Math.min(...vs) / step) * step;
                const w = Math.ceil((Math.max(...us) - u) / step), h = Math.ceil((Math.max(...vs) - v) / step);
                if (w * h > 4194304 || scanned + w * h > 16777216) continue;
                scanned += w * h;
                const pixels = new Uint8ClampedArray(w * h * 4);
                for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                    const pu = u + (x + 0.5) * step, pv = v + (y + 0.5) * step;
                    if (contains(pu * c - pv * s, pu * s + pv * c)) pixels[(y * w + x) * 4 + 3] = 255;
                }
                for (const area of Extruder.scanAreas(pixels, w, h, {mode: 'areas', scan_tolerance: 128})) {
                    const pu = u + (area.x + area.x2 + 1) / 2 * step, pv = v + (area.y + area.y2 + 1) / 2 * step;
                    addCandidate({x: pu * c - pv * s, y: pu * s + pv * c,
                        length: (area.x2 - area.x + 1) * step, thickness: (area.y2 - area.y + 1) * step, angle});
                }
            }
        }
        const rectangles = [];
        const boundaryCells = new Map();
        const cellVertices = (x, y) => {
            const key = y * width + x;
            if (boundaryCells.has(key)) return boundaryCells.get(key);
            const x1 = left + x * step, x2 = x1 + step, y1 = top + y * step, y2 = y1 + step;
            const corners = [{x: x1, y: y1}, {x: x2, y: y1}, {x: x2, y: y2}, {x: x1, y: y2}];
            if (boundaryCells.size >= 100000) return corners;
            const points = corners.filter(p => contains(p.x, p.y));
            for (const {a, b, minX, maxX} of rows.get(Math.floor((y1 + y2) / 2 / rowSize)) || []) {
                if (minX > x2 || maxX < x1 || Math.min(a.y, b.y) > y2 || Math.max(a.y, b.y) < y1) continue;
                const dx = b.x - a.x, dy = b.y - a.y;
                let enter = 0, leave = 1;
                for (const [value, delta, low, high] of [[a.x, dx, x1, x2], [a.y, dy, y1, y2]]) {
                    if (Math.abs(delta) < 1e-10) {
                        if (value < low || value > high) { leave = -1; break; }
                    } else {
                        const from = (low - value) / delta, to = (high - value) / delta;
                        enter = Math.max(enter, Math.min(from, to)); leave = Math.min(leave, Math.max(from, to));
                    }
                }
                if (enter <= leave) points.push({x: a.x + dx * enter, y: a.y + dy * enter}, {x: a.x + dx * leave, y: a.y + dy * leave});
            }
            const result = points.length ? points : corners;
            boundaryCells.set(key, result);
            return result;
        };
        let coverageChecks = 0;
        for (const rect of candidates.sort((a, b) => b.length * b.thickness - a.length * a.thickness)) {
            const c = Math.cos(rect.angle), s = Math.sin(rect.angle);
            const hx = (Math.abs(c) * rect.length + Math.abs(s) * rect.thickness) / 2;
            const hy = (Math.abs(s) * rect.length + Math.abs(c) * rect.thickness) / 2;
            const x1 = Math.max(0, Math.floor((rect.x - hx - left) / step)), x2 = Math.min(width - 1, Math.floor((rect.x + hx - left) / step));
            const y1 = Math.max(0, Math.floor((rect.y - hy - top) / step)), y2 = Math.min(height - 1, Math.floor((rect.y + hy - top) / step));
            if (coverageChecks + (x2 - x1 + 1) * (y2 - y1 + 1) > 16777216) break;
            coverageChecks += (x2 - x1 + 1) * (y2 - y1 + 1);
            const covered = [], margin = (Math.abs(c) + Math.abs(s)) * step / 2;
            for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
                const index = y * width + x;
                if (!remaining[index]) continue;
                const dx = left + (x + 0.5) * step - rect.x, dy = top + (y + 0.5) * step - rect.y;
                const u = Math.abs(dx * c + dy * s), v = Math.abs(-dx * s + dy * c);
                if (u > rect.length / 2 + 1e-7 || v > rect.thickness / 2 + 1e-7) continue;
                if ((u + margin <= rect.length / 2 + 1e-7 && v + margin <= rect.thickness / 2 + 1e-7)
                    || cellVertices(x, y).every(p => Math.abs((p.x - rect.x) * c + (p.y - rect.y) * s) <= rect.length / 2 + 1e-7
                        && Math.abs(-(p.x - rect.x) * s + (p.y - rect.y) * c) <= rect.thickness / 2 + 1e-7)) covered.push(index);
            }
            if (covered.length < Math.max(4, rect.length * rect.thickness / (step * step) * 0.6)) continue;
            rectangles.push(rect);
            covered.forEach(i => {remaining[i] = 0;});
        }

        const residual = new Uint8ClampedArray(remaining.length * 4);
        remaining.forEach((value, i) => {residual[i * 4 + 3] = value ? 255 : 0;});
        for (const area of Extruder.scanAreas(residual, width, height, {mode: 'areas', scan_tolerance: 128})) {
            rectangles.push({x: left + (area.x + area.x2 + 1) / 2 * step, y: top + (area.y + area.y2 + 1) / 2 * step,
                length: (area.x2 - area.x + 1) * step, thickness: (area.y2 - area.y + 1) * step, angle: 0});
        }
        if (rectangles.length > MAX_CUBES) throw new Error('整字填充方块过多，请降低轮廓精度或分批生成。');
        return mergeNearbyRectangles(rectangles, fits);
    }

    function mergeNearbyRectangles(rectangles, fits) {
        const cellSize = 16, maxChecks = 50000, maxCellsPerBox = 8192;
        const buckets = new Map(), items = rectangles.map(rect => ({...rect, active: true, cells: []}));
        let checks = 0, merges = 0;
        const corners = rect => {
            const c = Math.cos(rect.angle), s = Math.sin(rect.angle), points = [];
            for (const x of [-rect.length / 2, rect.length / 2]) {
                for (const y of [-rect.thickness / 2, rect.thickness / 2]) {
                    points.push({x: rect.x + x * c - y * s, y: rect.y + x * s + y * c});
                }
            }
            return points;
        };
        const cellsFor = rect => {
            const points = corners(rect);
            const minX = Math.floor((Math.min(...points.map(p => p.x)) - 0.25) / cellSize), maxX = Math.floor((Math.max(...points.map(p => p.x)) + 0.25) / cellSize);
            const minY = Math.floor((Math.min(...points.map(p => p.y)) - 0.25) / cellSize), maxY = Math.floor((Math.max(...points.map(p => p.y)) + 0.25) / cellSize);
            if ((maxX - minX + 1) * (maxY - minY + 1) > maxCellsPerBox) return [];
            const cells = [];
            for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) cells.push(`${x},${y}`);
            return cells;
        };
        const addToBuckets = (item, index) => {
            item.cells = cellsFor(item);
            item.cells.forEach(key => {
                if (!buckets.has(key)) buckets.set(key, []);
                buckets.get(key).push(index);
            });
        };
        const majorAngle = rect => {
            const angle = rect.angle + (rect.thickness > rect.length ? Math.PI / 2 : 0);
            return ((angle % Math.PI) + Math.PI) % Math.PI;
        };
        const containsRectangle = (outer, inner) => {
            const c = Math.cos(outer.angle), s = Math.sin(outer.angle);
            return corners(inner).every(p => Math.abs((p.x - outer.x) * c + (p.y - outer.y) * s) <= outer.length / 2 + 1e-7
                && Math.abs(-(p.x - outer.x) * s + (p.y - outer.y) * c) <= outer.thickness / 2 + 1e-7);
        };
        const mergedBox = (a, b) => {
            const angleA = majorAngle(a), angleB = majorAngle(b);
            let delta = angleB - angleA;
            delta = Math.atan2(Math.sin(2 * delta), Math.cos(2 * delta)) / 2;
            if (Math.abs(delta) > 0.105) return null;
            const weightA = Math.max(a.length, a.thickness), weightB = Math.max(b.length, b.thickness);
            const angle = angleA + Math.atan2(weightB * Math.sin(2 * delta), weightA + weightB * Math.cos(2 * delta)) / 2;
            const tx = Math.cos(angle), ty = Math.sin(angle), nx = -ty, ny = tx;
            let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
            for (const rect of [a, b]) for (const p of corners(rect)) {
                const u = p.x * tx + p.y * ty, v = p.x * nx + p.y * ny;
                minU = Math.min(minU, u); maxU = Math.max(maxU, u);
                minV = Math.min(minV, v); maxV = Math.max(maxV, v);
            }
            const length = maxU - minU, thickness = maxV - minV;
            if (length > weightA + weightB + 0.5 || thickness > Math.max(Math.min(a.length, a.thickness), Math.min(b.length, b.thickness)) * 2 + 0.5) return null;
            const x = tx * (minU + maxU) / 2 + nx * (minV + maxV) / 2;
            const y = ty * (minU + maxU) / 2 + ny * (minV + maxV) / 2;
            const start = {x: x - tx * length / 2 - nx * thickness / 2, y: y - ty * length / 2 - ny * thickness / 2};
            const end = {x: x + tx * length / 2 - nx * thickness / 2, y: y + ty * length / 2 - ny * thickness / 2};
            return fits(start, end, tx, ty, length, thickness) ? {x, y, length, thickness, angle: ((angle % Math.PI) + Math.PI) % Math.PI} : null;
        };

        items.forEach(addToBuckets);
        for (let i = 0; i < items.length && checks < maxChecks && merges < MAX_CUBES; i++) {
            const item = items[i];
            if (!item.active) continue;
            const nearby = new Set(item.cells.flatMap(key => buckets.get(key) || []));
            for (const j of [...nearby].sort((a, b) => a - b)) {
                if (j === i || !items[j].active || ++checks > maxChecks) continue;
                if (containsRectangle(item, items[j])) { items[j].active = false; merges++; continue; }
                if (containsRectangle(items[j], item)) { item.active = false; merges++; break; }
                const combined = mergedBox(item, items[j]);
                if (!combined) continue;
                item.active = items[j].active = false;
                items.push({...combined, active: true, cells: []});
                addToBuckets(items.at(-1), items.length - 1);
                merges++;
                break;
            }
        }
        return items.filter(item => item.active).map(({x, y, length, thickness, angle}) => ({x, y, length, thickness, angle}));
    }

    function boxOutline(box) {
        const origin = box.origin || [0, 0, 0], angle = (box.rotation?.[2] || 0) * Math.PI / 180;
        const c = Math.cos(angle), s = Math.sin(angle);
        return [[box.from[0], box.from[1]], [box.to[0], box.from[1]], [box.to[0], box.to[1]], [box.from[0], box.to[1]]].map(([x, y]) => ({
            x: origin[0] + (x - origin[0]) * c - (y - origin[1]) * s,
            y: origin[1] + (x - origin[0]) * s + (y - origin[1]) * c
        }));
    }

    function drawModelPreview(canvas, boxes) {
        const outlines = boxes.map(boxOutline);
        let left = Infinity, right = -Infinity, top = -Infinity, bottom = Infinity;
        outlines.forEach(points => points.forEach(p => {
            left = Math.min(left, p.x); right = Math.max(right, p.x);
            top = Math.max(top, p.y); bottom = Math.min(bottom, p.y);
        }));
        const scale = Math.min((canvas.width - 16) / (right - left), (canvas.height - 16) / (top - bottom));
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.setTransform(scale, 0, 0, -scale, (canvas.width - (right - left) * scale) / 2 - left * scale, (canvas.height - (top - bottom) * scale) / 2 + top * scale);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        outlines.forEach(points => {
            ctx.moveTo(points[0].x, points[0].y);
            points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
            ctx.closePath();
        });
        ctx.fill();
        ctx.restore();
    }

    function createModel(boxes, text) {
        if (!Project || !Modes.edit) throw new Error('请先打开模型项目并切换到编辑模式。');
        if (Undo.current_save) throw new Error('请先完成当前编辑操作，再创建文字。');
        const elements = [], groups = [];
        const aspects = {elements, groups, outliner: true, selection: true};
        Undo.initEdit(aspects);
        try {
            const name = '文字_' + text.trim().replace(/\s+/g, '_').slice(0, 24);
            const group = new Group({name, origin: [0, 0, 0], color: 0});
            groups.push(group);
            group.isOpen = true;
            if (group.getTypeBehavior('unique_name')) group.createUniqueName();
            group.init();
            const characterGroups = new Map();
            boxes.forEach((box, i) => {
                let parent = group;
                if (box.character) {
                    const {index, text: character, origin} = box.character;
                    if (!characterGroups.has(index)) {
                        const child = new Group({name: `char_${index + 1}_${character}`, origin: origin || [0, 0, 0], color: group.color});
                        groups.push(child);
                        if (child.getTypeBehavior('unique_name')) child.createUniqueName();
                        child.addTo(group).init();
                        characterGroups.set(index, child);
                    }
                    parent = characterGroups.get(index);
                }
                const cube = new Cube({name: `text_${i + 1}`, from: box.from, to: box.to, origin: box.origin || [0, 0, 0], rotation: box.rotation || [0, 0, 0], color: group.color, autouv: settings.autouv.value ? 1 : 0});
                elements.push(cube);
                cube.addTo(parent).init();
                if (!cube.box_uv) cube.mapAutoUV();
            });
            Canvas.updateView({elements, element_aspects: {transform: true, geometry: true, faces: true}});
            if (Format.cube_size_limiter && !settings.deactivate_size_limit.value && elements.some(cube => Format.cube_size_limiter.test(cube))) {
                throw new Error('文字超出当前格式的模型范围。请减小字号或厚度，或改用自由模型/基岩版实体格式。');
            }
            group.select();
            Undo.finishEdit('创建文字方块模型', aspects);
            return group;
        } catch (error) {
            Undo.cancelEdit(true);
            Undo.cancelSelection(true);
            throw error;
        }
    }

    function openDialog() {
        if (currentDialog) {
            if (currentDialog.alive()) { currentDialog.dialog.focus(); return; }
            currentDialog.dialog.delete();
        }
        let alive = true, busy = false, sequence = 0, timer, fileRequest;
        const fonts = [], fileCache = new Map();
        let lastPrepared;
        const form = {
            text: 'Blockbench', font: 'sans-serif', custom_font: '', font_file: null,
            size: Format.integer_size ? 32 : 16, depth: 1, resolution: 64,
            edge_mode: 'pixels',
            smoothing: 1.5, group_characters: true
        };
        const preview = document.createElement('canvas');
        preview.width = 480;
        preview.height = 120;
        preview.className = 'tc-preview';
        preview.setAttribute('aria-label', '文字方块正面轮廓预览');
        const status = document.createElement('p');
        status.className = 'tc-status';
        status.setAttribute('role', 'status');
        status.textContent = '正在准备预览...';
        const root = document.createElement('div');
        root.className = 'tc-studio';
        root.innerHTML = `
            <div class="tc-layout">
                <main class="tc-main" aria-label="文字模型预览">
                    <div class="tc-head"><h3>3D 字形预览</h3><span class="tc-badge" data-count>预览中</span></div>
                    <div class="tc-stage"></div>
                    <p class="tc-muted">正面朝向 +Z，文字底部对齐 Y=0，预览显示实际方块轮廓。</p>
                </main>
                <aside class="tc-sidebar" aria-label="文字生成设置">
                    <section class="tc-card"><div class="tc-card-head"><h4>文字与字体</h4></div><div class="tc-controls">
                        <label class="tc-field" for="tc-text">输入文字<textarea id="tc-text" data-field="text" maxlength="512" placeholder="输入文字，可换行"></textarea></label>
                        <label class="tc-field" for="tc-font">字体<select id="tc-font" data-field="font" aria-label="字体"></select></label>
                        <label class="tc-field" data-custom-font for="tc-custom-font">字体名称<input id="tc-custom-font" data-field="custom_font" type="text" maxlength="100" placeholder="输入系统已安装的字体名称"></label>
                        <div class="tc-file-row"><span class="tc-file-name" data-file-name>未导入字体文件</span><span class="tc-file-actions"><button type="button" class="tc-btn" data-action="font">选择字体文件</button><button type="button" class="tc-btn tc-clear-font" data-action="clear-font" aria-label="移除字体文件" title="移除字体文件" hidden>移除字体文件</button></span></div>
                    </div></section>
                    <section class="tc-card"><div class="tc-card-head"><h4>模型外观</h4></div><div class="tc-controls">
                        <div class="tc-number-row">
                            <label class="tc-field" for="tc-size">字号<input id="tc-size" data-field="size" type="number" min="0.1" max="256" step="1"></label>
                            <label class="tc-field" for="tc-depth">厚度<input id="tc-depth" data-field="depth" type="number" min="0.01" max="256" step="0.25"></label>
                            <label class="tc-field" for="tc-resolution">精度<input id="tc-resolution" data-field="resolution" type="number" min="8" max="256" step="1"></label>
                        </div>
                        <label class="tc-field" for="tc-mode">生成方式<select id="tc-mode" data-field="edge_mode"><option value="smooth">旋转填充（测试，不推荐使用）</option><option value="pixels">像素方块</option></select></label>
                        <label class="tc-field" data-smoothing for="tc-smoothing">轮廓去抖 <span data-smoothing-value></span><input id="tc-smoothing" data-field="smoothing" type="range" min="0" max="4" step="0.25"></label>
                    </div></section>
                    <section class="tc-card"><div class="tc-card-head"><h4>输出结构</h4></div><div class="tc-controls">
                        <label class="tc-toggle" for="tc-groups"><span>每个字单独分组</span><input id="tc-groups" data-field="group_characters" type="checkbox"></label>
                    </div></section>
                </aside>
            </div>
            <footer class="tc-footer"><button type="button" class="tc-btn" data-action="cancel">取消</button><button type="button" class="tc-btn tc-btn-primary" data-action="create">创建模型</button></footer>
        `;
        root.querySelector('.tc-stage').append(preview, status);
        root.querySelector('[data-field="font"]').innerHTML = Object.entries(FONT_OPTIONS).map(([value, name]) => `<option value="${value}">${name}</option>`).join('');

        function syncForm() {
            root.querySelectorAll('[data-field]').forEach(input => {
                form[input.dataset.field] = input.type === 'checkbox' ? input.checked
                    : input.type === 'number' || input.type === 'range' ? input.valueAsNumber : input.value;
            });
            root.querySelector('[data-custom-font]').hidden = form.font !== 'custom';
            root.querySelector('[data-smoothing]').hidden = form.edge_mode !== 'smooth';
            root.querySelector('[data-smoothing-value]').textContent = `${form.smoothing} px`;
        }

        function updateFileLabel() {
            root.querySelector('[data-file-name]').textContent = form.font_file?.name || '未导入字体文件';
            root.querySelector('[data-action="clear-font"]').hidden = !form.font_file;
        }

        function release() {
            alive = false;
            sequence++;
            clearTimeout(timer);
            fonts.forEach(face => document.fonts.delete(face));
            fonts.length = 0;
            fileCache.clear();
            lastPrepared = undefined;
            fileRequest = null;
        }

        async function resolveFont(form, options) {
            if (!form.font_file) {
                const family = ['sans-serif', 'serif', 'monospace'].includes(options.family) ? options.family : JSON.stringify(options.family);
                await document.fonts.load(`${options.resolution}px ${family}`, options.text);
                return family;
            }
            const file = form.font_file;
            if (!file.content || !Number.isFinite(file.content.byteLength) || file.content.byteLength > 20 * 1024 * 1024) {
                throw new Error('字体文件无效或超过 20 MB，请选择 TTF、OTF、WOFF 或 WOFF2 文件。');
            }
            if (!fileCache.has(file)) {
                const family = `TextCubesFont_${++fontId}`;
                const promise = new FontFace(family, file.content).load().then(face => {
                    if (alive) { document.fonts.add(face); fonts.push(face); }
                    return JSON.stringify(family);
                }).catch(() => { throw new Error('无法加载字体文件，请检查文件是否损坏或格式是否受支持。'); });
                fileCache.set(file, promise);
            }
            return fileCache.get(file);
        }

        async function prepare(form, isCurrent = () => true) {
            const options = validateForm(form);
            const family = await resolveFont(form, options);
            if (!alive || !isCurrent()) return null;
            const key = JSON.stringify([options, family, Format.integer_size, Format.rotate_cubes, Format.rotation_limit, Format.rotation_snap]);
            if (lastPrepared?.key === key) return lastPrepared.result;
            const raster = rasterizeText(options.text, family, options.resolution);
            const boxes = makeTextBoxes(raster, options, family, Format.integer_size);
            lastPrepared = {key, result: {options, raster, boxes}};
            return lastPrepared.result;
        }

        function schedulePreview(form) {
            const ticket = ++sequence;
            clearTimeout(timer);
            timer = setTimeout(async () => {
                try {
                    const result = await prepare(form, () => ticket === sequence);
                    if (!alive || ticket !== sequence || !result) return;
                    drawModelPreview(preview, result.boxes);
                    root.querySelector('[data-count]').textContent = `${result.boxes.length} 个方块`;
                    status.textContent = `预计 ${result.boxes.length} 个方块${result.options.groupCharacters ? '，每字独立分组' : ''}`;
                } catch (error) {
                    if (alive && ticket === sequence) {
                        preview.getContext('2d').clearRect(0, 0, preview.width, preview.height);
                        root.querySelector('[data-count]').textContent = '预览不可用';
                        status.textContent = error.message;
                    }
                }
            }, 220);
        }

        const dialog = new Dialog({
            id: 'text_to_cubes_dialog', title: '字形建模生成器', width: Math.min(960, window.innerWidth - 24), resizable: true, darken: false, cancel_on_click_outside: false,
            lines: [root], buttons: [],
            onBuild() {
                this.object.style.width = `min(960px, calc(100vw - 24px))`;
                this.object.style.height = `${Math.round(Math.min(760, window.innerHeight - 40))}px`;
                this.object.addEventListener('keydown', event => {
                    event.stopPropagation();
                    if (event.key === 'Escape') { event.preventDefault(); this.cancel(); }
                });
            },
            onOpen() { syncForm(); schedulePreview({...form}); },
            onCancel() { release(); },
            onButton() { release(); },
            onConfirm() {
                if (busy) return false;
                syncForm();
                busy = true;
                sequence++;
                clearTimeout(timer);
                const project = Project;
                const button = root.querySelector('[data-action="create"]');
                button.disabled = true;
                status.textContent = '正在生成模型...';
                prepare(form).then(result => {
                    if (!alive || !result) return;
                    if (Project !== project) throw new Error('项目已切换，请重新打开菜单后创建。');
                    createModel(result.boxes, result.options.text);
                    release();
                    dialog.hide();
                    Blockbench.showQuickMessage(`已创建文字模型：${result.boxes.length} 个方块。`, 3000);
                }).catch(error => {
                    if (alive) {
                        root.querySelector('[data-count]').textContent = '无法生成';
                        status.textContent = error.message;
                        Blockbench.showQuickMessage(error.message, 5000);
                    }
                }).finally(() => { busy = false; if (alive) button.disabled = false; });
                return false;
            }
        });
        root.addEventListener('input', () => {
            syncForm();
            if (!busy) schedulePreview({...form});
        });
        root.addEventListener('change', event => {
            if (event.target.type === 'number' && !Number.isFinite(event.target.valueAsNumber)) {
                status.textContent = '请输入有效数值。';
                return;
            }
            syncForm();
            if (!busy) schedulePreview({...form});
        });
        root.addEventListener('keydown', event => {
            if (event.key !== 'Escape' && event.target.matches('input, textarea, select, button')) event.stopPropagation();
        });
        root.addEventListener('click', event => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            if (button.dataset.action === 'cancel') { dialog.cancel(); return; }
            if (button.dataset.action === 'create') { dialog.onConfirm(); return; }
            if (button.dataset.action === 'clear-font') {
                form.font_file = null; updateFileLabel(); schedulePreview({...form}); return;
            }
            if (button.dataset.action === 'font') {
                fileRequest = files => {
                    if (!alive || !files?.length) return;
                    form.font_file = files[0];
                    updateFileLabel();
                    schedulePreview({...form});
                };
                Blockbench.import({resource_id: 'text_to_cubes_font', extensions: ['ttf', 'otf', 'woff', 'woff2'], type: '字体文件', readtype: 'buffer'}, files => {
                    const callback = fileRequest; fileRequest = null; callback?.(files);
                });
            }
        });
        root.querySelectorAll('[data-field]').forEach(input => { input.value = form[input.dataset.field] ?? ''; });
        root.querySelector('[data-field="group_characters"]').checked = form.group_characters;
        root.querySelector('[data-field="font"]').value = form.font;
        updateFileLabel();
        currentDialog = {dialog, release, alive: () => alive};
        dialog.show();
    }

    if (globalThis.__TEXT_TO_CUBES_TEST__) {
        globalThis.__TEXT_TO_CUBES_INTERNALS__ = {validateForm, rasterizeText, makeBoxes, makeTextBoxes, createModel, boxOutline, fillRotatedRegions, simplifyLoop, mergeNearbyRectangles, drawModelPreview};
    }

    BBPlugin.register('text_to_cubes', {
        title: '字形建模生成器', icon: 'text_fields', author: 'PuddingKC',
        description: '选择系统字体或本地字体文件，将文字转换为方块模型。',
        version: '1.5.0', min_version: '5.2.2', variant: 'both', tags: ['Text', 'Cube'],
        about: [
			'在 **工具 → 字形建模生成器** 中打开',
            '',
			'官方更新地址：https://github.com/Null-K/blockbench-plugins'
		].join('\n'),
        onload() {
            cssHandle = Blockbench.addCSS(CSS);
            action = new Action('text_to_cubes', {
                name: '字形建模生成器', icon: 'text_fields', category: 'tools',
                condition: () => !!Project && Modes.edit, click: openDialog
            });
            MenuBar.addAction(action, 'tools');
        },
        onunload() {
            if (currentDialog) {
                if (currentDialog.alive()) currentDialog.dialog.hide();
                currentDialog.release();
                currentDialog.dialog.delete();
                currentDialog = null;
            }
            if (action) action.delete();
            if (cssHandle) cssHandle.delete();
        }
    });
})();
