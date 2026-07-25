(function () {

	function rgbToHsl(r, g, b) {
		r /= 255; g /= 255; b /= 255;
		let max = Math.max(r, g, b), min = Math.min(r, g, b);
		let h = 0, s, l = (max + min) / 2;
		if (max !== min) {
			let d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			switch (max) {
				case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
				case g: h = ((b - r) / d + 2) / 6; break;
				case b: h = ((r - g) / d + 4) / 6; break;
			}
		} else {
			s = 0;
		}
		return { h: h * 360, s: s * 100, l: l * 100 };
	}

	function hue2rgb(p, q, t) {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	}

	function hslToRgb(h, s, l) {
		h = ((h % 360) + 360) % 360;
		h /= 360; s /= 100; l /= 100;
		let r, g, b;
		if (s === 0) {
			r = g = b = l;
		} else {
			let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
			let p = 2 * l - q;
			r = hue2rgb(p, q, h + 1 / 3);
			g = hue2rgb(p, q, h);
			b = hue2rgb(p, q, h - 1 / 3);
		}
		return {
			r: Math.round(Math.clamp(r * 255, 0, 255)),
			g: Math.round(Math.clamp(g * 255, 0, 255)),
			b: Math.round(Math.clamp(b * 255, 0, 255))
		};
	}

	function toHex(r, g, b) {
		return '#' + [r, g, b].map(v =>
			Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
		).join('');
	}

	let hsl_tool;
	let color_listener;
	let panel_el = null;

	let panel_pos = null;
	let shift = { h: 0, s: 0, l: 0 };

	function getCurrentBaseHsl() {
		try {
			let c = tinycolor(ColorPanel.get(false)).toRgb();
			return rgbToHsl(c.r, c.g, c.b);
		} catch (e) {
			return { h: 0, s: 100, l: 50 };
		}
	}

	function buildHueGrad(bh, bs, bl) {
		const N = 13;
		let stops = [];
		for (let i = 0; i <= N; i++) {
			let t = i / N;
			let c = hslToRgb(bh + (t - 0.5) * 360, bs, bl);
			stops.push(`${toHex(c.r, c.g, c.b)} ${(t * 100).toFixed(1)}%`);
		}
		return `linear-gradient(to right, ${stops.join(', ')})`;
	}

	function buildSatGrad(bh, bl) {
		let c0 = hslToRgb(bh, 0, bl), c1 = hslToRgb(bh, 100, bl);
		return `linear-gradient(to right, ${toHex(c0.r, c0.g, c0.b)}, ${toHex(c1.r, c1.g, c1.b)})`;
	}

	function buildLitGrad(bh, bs) {
		let cm = hslToRgb(bh, bs, 50);
		return `linear-gradient(to right, #000000, ${toHex(cm.r, cm.g, cm.b)}, #ffffff)`;
	}

	function valToPercent(ch, val) {
		return ch === 'h' ? ((val + 180) / 360) * 100 : ((val + 100) / 200) * 100;
	}
	function percentToVal(ch, pct) {
		return ch === 'h' ? pct / 100 * 360 - 180 : pct / 100 * 200 - 100;
	}
	function clampVal(ch, val) {
		return ch === 'h'
			? Math.clamp(Math.round(val), -180, 180)
			: Math.clamp(Math.round(val), -100, 100);
	}

	function syncUI() {
		if (!panel_el) return;
		['h', 's', 'l'].forEach(ch => {
			let thumb = panel_el.querySelector(`#hsl_thumb_${ch}`);
			let num = panel_el.querySelector(`#hsl_num_${ch}`);
			if (thumb) thumb.style.left = valToPercent(ch, shift[ch]) + '%';
			if (num) num.value = shift[ch];
		});
		updatePreview();
	}

	function updateGradients() {
		if (!panel_el) return;
		let b = getCurrentBaseHsl();
		let th = panel_el.querySelector('#hsl_track_h');
		let ts = panel_el.querySelector('#hsl_track_s');
		let tl = panel_el.querySelector('#hsl_track_l');
		if (th) th.style.background = buildHueGrad(b.h, b.s, b.l);
		if (ts) ts.style.background = buildSatGrad(b.h, b.l);
		if (tl) tl.style.background = buildLitGrad(b.h, b.s);
		updatePreview();
	}

	function updatePreview() {
		if (!panel_el) return;
		let b = getCurrentBaseHsl();
		let brgb = hslToRgb(b.h, b.s, b.l);
		let new_h = ((b.h + shift.h) % 360 + 360) % 360;
		let new_s = Math.clamp(b.s + shift.s, 0, 100);
		let new_l = Math.clamp(b.l + shift.l, 0, 100);
		let srgb = hslToRgb(new_h, new_s, new_l);
		let from_el = panel_el.querySelector('#hsl_preview_from');
		let to_el = panel_el.querySelector('#hsl_preview_to');
		if (from_el) from_el.style.background = toHex(brgb.r, brgb.g, brgb.b);
		if (to_el) to_el.style.background = toHex(srgb.r, srgb.g, srgb.b);
	}

	function savePos() {
		if (!panel_el) return;
		panel_pos = {
			left: panel_el.style.left || (panel_el.offsetLeft + 'px'),
			top: panel_el.style.top || (panel_el.offsetTop + 'px')
		};
	}

	function createPanel() {
		if (panel_el) return;

		if (!document.getElementById('hsl_shift_css')) {
			let st = document.createElement('style');
			st.id = 'hsl_shift_css';
			st.textContent = `
				#hsl_shift_panel{position:fixed;top:64px;right:24px;width:264px;background:var(--color-back);border:2px solid var(--color-accent);border-radius:6px;z-index:20;box-shadow:0 6px 20px rgba(0,0,0,.65);font-family:var(--font-custom-main,sans-serif);font-size:12px;color:var(--color-text);user-select:none}
				#hsl_shift_title{display:flex;justify-content:space-between;align-items:center;padding:5px 9px;background:var(--color-accent);color:var(--color-accent_text,white);font-weight:bold;cursor:move;border-radius:4px 4px 0 0;font-size:13px}
				#hsl_shift_close{cursor:pointer;font-size:14px;padding:0 3px}
				#hsl_shift_body{padding:8px 10px}
				#hsl_preview_row{display:flex;align-items:center;gap:7px;margin-bottom:10px;justify-content:center}
				#hsl_preview_from,#hsl_preview_to{width:40px;height:26px;border-radius:4px;border:1px solid rgba(255,255,255,.2);flex-shrink:0}
				#hsl_preview_arrow{font-size:15px;opacity:.55}
				.hsl-row{display:flex;align-items:center;gap:6px;margin-bottom:7px}
				.hsl-label{width:28px;font-size:11px;opacity:.75;flex-shrink:0;text-align:right}
				.hsl-track{flex:1;height:14px;border-radius:7px;position:relative;border:1px solid rgba(255,255,255,.15);cursor:pointer}
				.hsl-thumb{position:absolute;top:50%;transform:translate(-50%,-50%);width:14px;height:14px;border-radius:50%;background:white;border:2px solid rgba(0,0,0,.55);box-shadow:0 1px 3px rgba(0,0,0,.5);pointer-events:none}
				.hsl-num{width:52px;background:var(--color-button);color:var(--color-text);border:1px solid var(--color-border);border-radius:3px;padding:2px 3px;font-size:11px;text-align:center;outline:none;flex-shrink:0}
				#hsl_reset_row{text-align:center;margin-top:4px}
				#hsl_reset_btn{background:var(--color-button);color:var(--color-text);border:1px solid var(--color-border);border-radius:3px;padding:2px 14px;cursor:pointer;font-size:11px}
				#hsl_reset_btn:hover{background:var(--color-selected)}`;
			document.head.appendChild(st);
		}

		panel_el = document.createElement('div');
		panel_el.id = 'hsl_shift_panel';

		if (panel_pos) {
			panel_el.style.left = panel_pos.left;
			panel_el.style.top = panel_pos.top;
			panel_el.style.right = 'auto';
		}

		panel_el.innerHTML = `
			<div id="hsl_shift_title">
				<span>HSL Shift</span>
				<span id="hsl_shift_close">&#10006;</span>
			</div>
			<div id="hsl_shift_body">
				<div id="hsl_preview_row" title="Current color → shifted result">
					<div id="hsl_preview_from"></div>
					<div id="hsl_preview_arrow">&#8594;</div>
					<div id="hsl_preview_to"></div>
				</div>
				<div class="hsl-row">
					<span class="hsl-label" title="Hue offset (−180 to +180)">Hue</span>
					<div class="hsl-track" id="hsl_track_h"><div class="hsl-thumb" id="hsl_thumb_h"></div></div>
					<input class="hsl-num" id="hsl_num_h" type="number" value="0" min="-180" max="180">
				</div>
				<div class="hsl-row">
					<span class="hsl-label" title="Saturation offset (−100 to +100)">Sat</span>
					<div class="hsl-track" id="hsl_track_s"><div class="hsl-thumb" id="hsl_thumb_s"></div></div>
					<input class="hsl-num" id="hsl_num_s" type="number" value="0" min="-100" max="100">
				</div>
				<div class="hsl-row">
					<span class="hsl-label" title="Lightness offset (−100 to +100)">Lit</span>
					<div class="hsl-track" id="hsl_track_l"><div class="hsl-thumb" id="hsl_thumb_l"></div></div>
					<input class="hsl-num" id="hsl_num_l" type="number" value="0" min="-100" max="100">
				</div>
				<div id="hsl_reset_row">
					<button id="hsl_reset_btn" type="button">Reset</button>
				</div>
			</div>`;

		document.body.appendChild(panel_el);
		bindPanelEvents();
		updateGradients();
		syncUI();
	}

	function destroyPanel() {
		if (!panel_el) return;
		savePos();
		panel_el.remove();
		panel_el = null;
	}

	function bindPanelEvents() {
		panel_el.querySelector('#hsl_shift_close').onclick = () => destroyPanel();

		let title = panel_el.querySelector('#hsl_shift_title');
		title.onmousedown = (e) => {
			if (e.target.id === 'hsl_shift_close') return;
			let ox = e.clientX - panel_el.offsetLeft;
			let oy = e.clientY - panel_el.offsetTop;
			let onMove = (ev) => {
				panel_el.style.left = (ev.clientX - ox) + 'px';
				panel_el.style.top = (ev.clientY - oy) + 'px';
				panel_el.style.right = 'auto';
			};
			let onUp = () => {
				savePos();
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		};

		['h', 's', 'l'].forEach(ch => {
			let track = panel_el.querySelector(`#hsl_track_${ch}`);
			let num = panel_el.querySelector(`#hsl_num_${ch}`);

			function applyPx(clientX) {
				let rect = track.getBoundingClientRect();
				let pct = Math.clamp((clientX - rect.left) / rect.width, 0, 1) * 100;
				shift[ch] = clampVal(ch, percentToVal(ch, pct));
				syncUI();
			}

			track.onmousedown = (e) => {
				applyPx(e.clientX);
				let onMove = (ev) => applyPx(ev.clientX);
				let onUp = () => {
					document.removeEventListener('mousemove', onMove);
					document.removeEventListener('mouseup', onUp);
				};
				document.addEventListener('mousemove', onMove);
				document.addEventListener('mouseup', onUp);
				e.preventDefault();
			};

			num.onchange = () => {
				shift[ch] = clampVal(ch, parseInt(num.value) || 0);
				syncUI();
			};
		});

		panel_el.querySelector('#hsl_reset_btn').onclick = () => {
			shift.h = 0; shift.s = 0; shift.l = 0;
			syncUI();
		};
	}

	BBPlugin.register('hsl_shift_brush', {
		title: 'HSL Shift Brush',
		author: 'PuddingKC',
		description: 'A paint tool that shifts the Hue, Saturation, and Lightness of existing pixels instead of replacing their colors.',
		icon: 'gradient',
		version: '1.2.0',
		min_version: '4.2.0',
		variant: 'both',
		tags: ['Textures', 'Paint'],

		onload() {
			hsl_tool = new Tool('hsl_shift_brush', {
				name: 'HSL Shift',
				description: 'Shift Hue, Saturation, and Lightness of painted pixels',
				icon: 'gradient',
				category: 'tools',
				toolbar: 'brush',
				alt_tool: 'color_picker',
				cursor: 'crosshair',
				selectFace: true,
				transformerMode: 'hidden',
				paintTool: true,
				allowed_view_modes: ['textured', 'material'],
				modes: ['paint'],
				keybind: new Keybind({ key: 'h' }),
				brush: {
					shapes: true,
					size: true,
					softness: true,
					opacity: true,
					offset_even_radius: true,
					floor_coordinates: () => BarItems.slider_brush_softness.get() === 0,
					get interval() {
						let size = Painter.current.dynamic_brush_size ?? BarItems.slider_brush_size.get();
						return 1 + size * BarItems.slider_brush_softness.get() / 1500;
					},
					changePixel(px, py, pxcolor, local_opacity, { opacity }) {
						if (pxcolor.a === 0) return pxcolor;
						let a = opacity * local_opacity;
						if (a <= 0) return pxcolor;

						let hsl = rgbToHsl(pxcolor.r, pxcolor.g, pxcolor.b);
						let new_h = ((hsl.h + shift.h * a) % 360 + 360) % 360;
						let new_s = Math.clamp(hsl.s + shift.s * a, 0, 100);
						let new_l = Math.clamp(hsl.l + shift.l * a, 0, 100);
						let rgb = hslToRgb(new_h, new_s, new_l);
						return { r: rgb.r, g: rgb.g, b: rgb.b, a: pxcolor.a };
					}
				},
				onCanvasClick(data) {
					Painter.startPaintToolCanvas(data, data.event);
				},
				onSelect() {
					Painter.updateNslideValues();
					Interface.addSuggestedModifierKey('alt', 'action.color_picker');
					Interface.addSuggestedModifierKey('shift', 'modifier_actions.draw_line');
					createPanel();
				},
				onUnselect() {
					Interface.removeSuggestedModifierKey('alt', 'action.color_picker');
					Interface.removeSuggestedModifierKey('shift', 'modifier_actions.draw_line');

					setTimeout(() => {
						let id = Toolbox.selected && Toolbox.selected.id;
						if (id !== 'color_picker' && id !== 'hsl_shift_brush') {
							destroyPanel();
						}
					}, 0);
				}
			});

			color_listener = Blockbench.on('change_color', () => {
				updateGradients();
			});
		},

		onunload() {
			if (hsl_tool) hsl_tool.delete();
			if (color_listener) { color_listener.delete(); color_listener = null; }
			destroyPanel();
			let s = document.getElementById('hsl_shift_css');
			if (s) s.remove();
		}
	});
})();
