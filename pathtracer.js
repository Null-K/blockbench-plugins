(function () {
	'use strict';

	const PLUGIN_ID = 'pathtracer';

	const TRI_POS_TEXELS = 3;
	const TRI_ATTR_TEXELS = 4;
	const MAT_TEXELS = 4;
	const BVH_TEXELS = 2;
	const DATA_TEX_WIDTH = 1024;
	const MAX_LEAF_TRIS = 8;
	const SAH_BINS = 12;
	const ENV_W = 1024, ENV_H = 512;
	const ENV_DIST_W = 256, ENV_DIST_H = 128;

	const DEFAULTS = {
		res_mode: 'fit',
		res_width: 1280,
		res_height: 720,
		max_samples: 256,
		max_bounce: 6,
		clamp_value: 12,
		filter_linear: false,
		denoise: true,
		denoise_strength: 1.0,
		interactive_scale: 0.5,
		auto_follow: false,

		ortho: false,
		fov: 45,
		aperture: 0,
		focus_distance: 0,
		auto_focus: true,
		auto_sync: false,

		env_mode: 'sky',
		env_intensity: 1.0,
		env_rotation: 0,
		bg_mode: 'env',
		bg_color: '#1b1b20',

		sun_enable: true,
		sun_elevation: 48,
		sun_azimuth: 140,
		sun_angle: 1.2,
		sun_intensity: 6.0,
		sun_color: '#fff2dd',
		sky_zenith: '#3c78c8',
		sky_horizon: '#c6dcf2',
		sky_ground: '#5a5a5e',
		sky_haze: 0.35,

		grad_top: '#8fb6e8',
		grad_bottom: '#2a2a2e',
		solid_color: '#808080',

		ground_on: true,
		ground_y: 0,
		ground_color: '#a8a8a8',
		ground_rough: 0.9,
		ground_metal: 0,
		ground_radius: 0,
		ground_catcher: false,

		render_sides: 'auto',
		def_roughness: 0.85,
		def_metalness: 0.0,
		emissive_strength: 1.0,
		alpha_mode: 'cutout',
		alpha_cutoff: 0.5,

		tone_mapping: 'aces',
		exposure: 1.0,
		contrast: 1.0,
		saturation: 1.0,

		bloom_enable: false,
		bloom_threshold: 1.0,
		bloom_intensity: 0.5,
		bloom_radius: 2.0,
		vignette_enable: false,
		vignette_strength: 0.4,
		sharpen_enable: false,
		sharpen_strength: 0.25,
		grain_enable: false,
		grain_strength: 0.03,
	};

	function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

	function hexToLinear(hex) {
		let h = (hex || '#000000').replace('#', '');
		if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
		const r = parseInt(h.substr(0, 2), 16) / 255;
		const g = parseInt(h.substr(2, 2), 16) / 255;
		const b = parseInt(h.substr(4, 2), 16) / 255;
		return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
	}

	function srgbToLinear(c) {
		return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	}

	function vNorm(v) {
		const l = Math.hypot(v[0], v[1], v[2]) || 1;
		return [v[0] / l, v[1] / l, v[2] / l];
	}
	function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
	function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
	function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
	function vCross(a, b) {
		return [
			a[1] * b[2] - a[2] * b[1],
			a[2] * b[0] - a[0] * b[2],
			a[0] * b[1] - a[1] * b[0],
		];
	}
	function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

	function nextPow2(n) {
		let p = 1;
		while (p < n) p *= 2;
		return p;
	}

	function compileShader(gl, type, source, label) {
		const sh = gl.createShader(type);
		gl.shaderSource(sh, source);
		gl.compileShader(sh);
		if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
			const log = gl.getShaderInfoLog(sh);
			console.error('[PathTracer] shader compile failed: ' + label + '\n' + log);
			console.error(source.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
			gl.deleteShader(sh);
			throw new Error('Shader compile error (' + label + '): ' + log);
		}
		return sh;
	}

	function createProgram(gl, vsSource, fsSource, label) {
		const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource, label + '.vert');
		const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource, label + '.frag');
		const prog = gl.createProgram();
		gl.attachShader(prog, vs);
		gl.attachShader(prog, fs);
		gl.linkProgram(prog);
		gl.deleteShader(vs);
		gl.deleteShader(fs);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
			const log = gl.getProgramInfoLog(prog);
			gl.deleteProgram(prog);
			throw new Error('Program link error (' + label + '): ' + log);
		}

		const uniforms = {};
		const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
		for (let i = 0; i < count; i++) {
			const info = gl.getActiveUniform(prog, i);
			const name = info.name.replace(/\[0\]$/, '');
			uniforms[name] = gl.getUniformLocation(prog, name);
		}
		return { program: prog, uniforms: uniforms };
	}

	function createDataTexture(gl, data, texelCount, width) {
		const w = width || DATA_TEX_WIDTH;
		const h = Math.max(1, Math.ceil(texelCount / w));
		const buf = new Float32Array(w * h * 4);
		if (data) buf.set(data.subarray(0, Math.min(data.length, buf.length)));
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, buf);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindTexture(gl.TEXTURE_2D, null);
		return { texture: tex, width: w, height: h };
	}

	function createR32FTexture(gl, data, w, h) {
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindTexture(gl.TEXTURE_2D, null);
		return tex;
	}

	function createAtlasTexture(gl, pixels, w, h) {
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindTexture(gl.TEXTURE_2D, null);
		return tex;
	}

	function createEnvTexture(gl, data, w, h) {
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, data);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindTexture(gl.TEXTURE_2D, null);
		return tex;
	}

	function createRenderTexture(gl, w, h, internalFormat) {
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		const fmt = internalFormat || gl.RGBA32F;
		const uploadFormat = fmt === gl.R32F ? gl.RED : gl.RGBA;
		gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, uploadFormat, gl.FLOAT, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindTexture(gl.TEXTURE_2D, null);
		return tex;
	}

	function createFBO(gl, attachments) {
		const fbo = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		const bufs = [];
		attachments.forEach((tex, i) => {
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
			bufs.push(gl.COLOR_ATTACHMENT0 + i);
		});
		gl.drawBuffers(bufs);
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		if (status !== gl.FRAMEBUFFER_COMPLETE) {
			throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
		}
		return fbo;
	}


	function buildBVH(positions, triCount) {
		if (triCount === 0) {
			const nodes = new Float32Array(8);
			nodes[3] = 0; nodes[7] = 0;
			return { nodes: nodes, nodeCount: 1, order: new Uint32Array(0) };
		}

		const bmin = new Float32Array(triCount * 3);
		const bmax = new Float32Array(triCount * 3);
		const cent = new Float32Array(triCount * 3);
		for (let i = 0; i < triCount; i++) {
			const o = i * 9;
			for (let a = 0; a < 3; a++) {
				const p0 = positions[o + a], p1 = positions[o + 3 + a], p2 = positions[o + 6 + a];
				const lo = Math.min(p0, p1, p2), hi = Math.max(p0, p1, p2);
				bmin[i * 3 + a] = lo;
				bmax[i * 3 + a] = hi;
				cent[i * 3 + a] = (lo + hi) * 0.5;
			}
		}

		const order = new Uint32Array(triCount);
		for (let i = 0; i < triCount; i++) order[i] = i;

		const maxNodes = Math.max(4, triCount * 2);
		const nodes = new Float32Array(maxNodes * 8);
		let nodeCount = 1;

		const stack = [[0, 0, triCount]];
		const tmp = new Uint32Array(triCount);

		while (stack.length) {
			const [nodeIdx, start, count] = stack.pop();

			let nx = Infinity, ny = Infinity, nz = Infinity;
			let xx = -Infinity, xy = -Infinity, xz = -Infinity;
			let cnx = Infinity, cny = Infinity, cnz = Infinity;
			let cxx = -Infinity, cxy = -Infinity, cxz = -Infinity;
			for (let i = start; i < start + count; i++) {
				const t = order[i], t3 = t * 3;
				if (bmin[t3] < nx) nx = bmin[t3];
				if (bmin[t3 + 1] < ny) ny = bmin[t3 + 1];
				if (bmin[t3 + 2] < nz) nz = bmin[t3 + 2];
				if (bmax[t3] > xx) xx = bmax[t3];
				if (bmax[t3 + 1] > xy) xy = bmax[t3 + 1];
				if (bmax[t3 + 2] > xz) xz = bmax[t3 + 2];
				if (cent[t3] < cnx) cnx = cent[t3];
				if (cent[t3 + 1] < cny) cny = cent[t3 + 1];
				if (cent[t3 + 2] < cnz) cnz = cent[t3 + 2];
				if (cent[t3] > cxx) cxx = cent[t3];
				if (cent[t3 + 1] > cxy) cxy = cent[t3 + 1];
				if (cent[t3 + 2] > cxz) cxz = cent[t3 + 2];
			}

			const no = nodeIdx * 8;
			nodes[no] = nx; nodes[no + 1] = ny; nodes[no + 2] = nz;
			nodes[no + 4] = xx; nodes[no + 5] = xy; nodes[no + 6] = xz;

			const makeLeaf = () => {
				nodes[no + 3] = start;
				nodes[no + 7] = count;
			};

			if (count <= 2) { makeLeaf(); continue; }

			const ext = [cxx - cnx, cxy - cny, cxz - cnz];
			let axis = 0;
			if (ext[1] > ext[axis]) axis = 1;
			if (ext[2] > ext[axis]) axis = 2;
			if (ext[axis] < 1e-9) { makeLeaf(); continue; }

			const cMin = [cnx, cny, cnz][axis];
			const scale = SAH_BINS / ext[axis];

			const binCount = new Int32Array(SAH_BINS);
			const binBounds = new Float32Array(SAH_BINS * 6);
			for (let b = 0; b < SAH_BINS; b++) {
				binBounds[b * 6] = binBounds[b * 6 + 1] = binBounds[b * 6 + 2] = Infinity;
				binBounds[b * 6 + 3] = binBounds[b * 6 + 4] = binBounds[b * 6 + 5] = -Infinity;
			}
			for (let i = start; i < start + count; i++) {
				const t = order[i], t3 = t * 3;
				let b = Math.floor((cent[t3 + axis] - cMin) * scale);
				if (b < 0) b = 0; else if (b >= SAH_BINS) b = SAH_BINS - 1;
				binCount[b]++;
				const bo = b * 6;
				for (let a = 0; a < 3; a++) {
					if (bmin[t3 + a] < binBounds[bo + a]) binBounds[bo + a] = bmin[t3 + a];
					if (bmax[t3 + a] > binBounds[bo + 3 + a]) binBounds[bo + 3 + a] = bmax[t3 + a];
				}
			}

			const leftArea = new Float32Array(SAH_BINS);
			const leftCount = new Int32Array(SAH_BINS);
			let al = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
			let acc = 0;
			for (let b = 0; b < SAH_BINS; b++) {
				if (binCount[b] > 0) {
					const bo = b * 6;
					for (let a = 0; a < 3; a++) {
						if (binBounds[bo + a] < al[a]) al[a] = binBounds[bo + a];
						if (binBounds[bo + 3 + a] > al[3 + a]) al[3 + a] = binBounds[bo + 3 + a];
					}
				}
				acc += binCount[b];
				leftCount[b] = acc;
				leftArea[b] = surfaceArea(al);
			}
			let bestCost = Infinity, bestBin = -1;
			let ar = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
			let accR = 0;
			for (let b = SAH_BINS - 1; b > 0; b--) {
				if (binCount[b] > 0) {
					const bo = b * 6;
					for (let a = 0; a < 3; a++) {
						if (binBounds[bo + a] < ar[a]) ar[a] = binBounds[bo + a];
						if (binBounds[bo + 3 + a] > ar[3 + a]) ar[3 + a] = binBounds[bo + 3 + a];
					}
				}
				accR += binCount[b];
				const lc = leftCount[b - 1], rc = accR;
				if (lc === 0 || rc === 0) continue;
				const cost = leftArea[b - 1] * lc + surfaceArea(ar) * rc;
				if (cost < bestCost) { bestCost = cost; bestBin = b; }
			}

			const parentArea = surfaceArea([nx, ny, nz, xx, xy, xz]);
			const leafCost = parentArea * count;
			if (bestBin < 0 || (bestCost >= leafCost && count <= MAX_LEAF_TRIS)) {
				makeLeaf();
				continue;
			}

			let w = 0;
			for (let i = start; i < start + count; i++) {
				const t = order[i];
				let b = Math.floor((cent[t * 3 + axis] - cMin) * scale);
				if (b < 0) b = 0; else if (b >= SAH_BINS) b = SAH_BINS - 1;
				if (b < bestBin) tmp[w++] = t;
			}
			const leftN = w;
			for (let i = start; i < start + count; i++) {
				const t = order[i];
				let b = Math.floor((cent[t * 3 + axis] - cMin) * scale);
				if (b < 0) b = 0; else if (b >= SAH_BINS) b = SAH_BINS - 1;
				if (b >= bestBin) tmp[w++] = t;
			}
			for (let i = 0; i < count; i++) order[start + i] = tmp[i];

			if (leftN === 0 || leftN === count) { makeLeaf(); continue; }

			const leftIdx = nodeCount;
			const rightIdx = nodeCount + 1;
			nodeCount += 2;
			if (rightIdx * 8 + 8 > nodes.length) { makeLeaf(); nodeCount -= 2; continue; }

			nodes[no + 3] = leftIdx;
			nodes[no + 7] = 0;

			stack.push([rightIdx, start + leftN, count - leftN]);
			stack.push([leftIdx, start, leftN]);
		}

		return { nodes: nodes, nodeCount: nodeCount, order: order };
	}

	function surfaceArea(b) {
		const dx = b[3] - b[0], dy = b[4] - b[1], dz = b[5] - b[2];
		if (dx < 0 || dy < 0 || dz < 0) return 0;
		return 2 * (dx * dy + dy * dz + dz * dx);
	}


	const MF_HAS_COLOR = 1;
	const MF_HAS_MER = 2;
	const MF_HAS_NORMAL = 4;
	const MF_FULLBRIGHT = 8;
	const MF_WRAP_REPEAT = 16;
	const MF_ADDITIVE = 32;

	function getMaterialSide(tex, override) {
		if (override === 'double') return 'double';
		if (override === 'front') return 'front';
		try {
			if (tex && tex.render_sides === 'front') return 'front';
			if (tex && tex.render_sides === 'double') return 'double';
			const global = (typeof settings !== 'undefined' && settings.render_sides)
				? settings.render_sides.value : 'auto';
			if (global === 'front') return 'front';
			if (global === 'auto') {
				if (typeof Format !== 'undefined' && Format && Format.render_sides) {
					const v = typeof Format.render_sides === 'function' ? Format.render_sides() : Format.render_sides;
					if (v === 'front') return 'front';
					if (v === 'back') return 'back';
					if (v === 'double') return 'double';
				}
			}
		} catch (err) { }
		return 'double';
	}

	function textureSource(tex) {
		if (!tex) return null;
		if (tex.canvas && tex.canvas.width > 1 && tex.canvas.height > 1) return tex.canvas;
		if (tex.img && tex.img.naturalWidth) return tex.img;
		return null;
	}

	function faceKeysPerTriangle(element, triCount) {
		try {
			if (element instanceof Cube) {
				const list = element.mesh && element.mesh.geometry && element.mesh.geometry.faces;
				if (list && list.length) {
					const out = new Array(triCount);
					for (let t = 0; t < triCount; t++) out[t] = list[Math.floor(t / 2)];
					return out;
				}
				const keys = [];
				(Canvas.face_order || ['east', 'west', 'up', 'down', 'south', 'north']).forEach(fkey => {
					if (element.faces[fkey] && element.faces[fkey].texture !== null) {
						keys.push(fkey, fkey);
					}
				});
				return keys;
			}
			if (typeof Mesh !== 'undefined' && element instanceof Mesh) {
				const keys = [];
				for (const fkey in element.faces) {
					const face = element.faces[fkey];
					if (!face.vertices || face.vertices.length < 3) continue;
					keys.push(fkey);
					if (face.vertices.length === 4) keys.push(fkey);
				}
				return keys;
			}
		} catch (err) {
			console.warn('[PathTracer] faceKeysPerTriangle failed', err);
		}
		return null;
	}

	function buildMaterialLookup() {
		const map = new Map();
		try {
			(Texture.all || []).forEach(tex => {
				if (tex.material) map.set(tex.material, tex);
			});
			if (typeof TextureGroup !== 'undefined') {
				(TextureGroup.all || []).forEach(group => {
					if (!group.is_material) return;
					const mat = group.material;
					if (!mat) return;
					const color = group.getTextures().find(t => t.pbr_channel === 'color') || group.getTextures()[0];
					if (color) map.set(mat, color);
				});
			}
		} catch (err) { }
		return map;
	}

	function collectGeometry() {
		const positions = [];
		const normals = [];
		const uvs = [];
		const texRefs = [];
		const flips = [];

		if (typeof Canvas !== 'undefined' && Canvas.scene) Canvas.scene.updateMatrixWorld(true);

		const matLookup = buildMaterialLookup();
		const defaultTexture = (typeof Texture !== 'undefined' && Texture.getDefault) ? Texture.getDefault() : null;

		const elements = (typeof Outliner !== 'undefined' && Outliner.elements) ? Outliner.elements : [];

		elements.forEach(element => {
			if (!element || element.visibility === false) return;
			const mesh = element.mesh;
			if (!mesh || !mesh.geometry || mesh.visible === false) return;
			const geo = mesh.geometry;
			const posAttr = geo.attributes && geo.attributes.position;
			if (!posAttr || !posAttr.array || posAttr.count < 3) return;

			const uvAttr = geo.attributes.uv;
			const nrmAttr = geo.attributes.normal;
			const index = geo.index;
			const triCount = index ? Math.floor(index.count / 3) : Math.floor(posAttr.count / 3);
			if (triCount <= 0) return;

			mesh.updateWorldMatrix(true, false);
			const m = mesh.matrixWorld.elements;
			const nm = normalMatrix3(m);
			const mirrored = mat3Determinant(m) < 0 ? 1 : 0;

			const fkeys = faceKeysPerTriangle(element, triCount);
			let fallbackTexture = defaultTexture;
			if (mesh.material && !Array.isArray(mesh.material) && matLookup.has(mesh.material)) {
				fallbackTexture = matLookup.get(mesh.material);
			}

			const pa = posAttr.array;
			const na = nrmAttr ? nrmAttr.array : null;
			const ua = uvAttr ? uvAttr.array : null;

			for (let t = 0; t < triCount; t++) {
				const i0 = index ? index.array[t * 3] : t * 3;
				const i1 = index ? index.array[t * 3 + 1] : t * 3 + 1;
				const i2 = index ? index.array[t * 3 + 2] : t * 3 + 2;
				const idx = [i0, i1, i2];

				const wp = [];
				for (let k = 0; k < 3; k++) {
					const o = idx[k] * 3;
					wp.push(transformPoint(m, pa[o], pa[o + 1], pa[o + 2]));
				}
				const e1 = vSub(wp[1], wp[0]);
				const e2 = vSub(wp[2], wp[0]);
				const cr = vCross(e1, e2);
				if (vDot(cr, cr) < 1e-14) continue;

				for (let k = 0; k < 3; k++) positions.push(wp[k][0], wp[k][1], wp[k][2]);

				if (na) {
					for (let k = 0; k < 3; k++) {
						const o = idx[k] * 3;
						const n = vNorm(transformDir(nm, na[o], na[o + 1], na[o + 2]));
						normals.push(n[0], n[1], n[2]);
					}
				} else {
					const gn = vNorm(cr);
					for (let k = 0; k < 3; k++) normals.push(gn[0], gn[1], gn[2]);
				}

				if (ua) {
					for (let k = 0; k < 3; k++) {
						const o = idx[k] * 2;
						uvs.push(ua[o], ua[o + 1]);
					}
				} else {
					uvs.push(0, 0, 1, 0, 0, 1);
				}

				let tex = fallbackTexture;
				const fkey = fkeys ? fkeys[t] : null;
				if (fkey != null && element.faces && element.faces[fkey]) {
					try {
						const ft = element.faces[fkey].getTexture();
						if (ft) tex = ft;
						else if (element.faces[fkey].texture === null) tex = null;
					} catch (err) { }
				}
				texRefs.push(tex || null);
				flips.push(mirrored);
			}
		});

		return {
			positions: new Float32Array(positions),
			normals: new Float32Array(normals),
			uvs: new Float32Array(uvs),
			texRefs: texRefs,
			flips: flips,
			triCount: texRefs.length,
		};
	}

	function mat3Determinant(m) {
		const a = m[0], b = m[1], c = m[2];
		const d = m[4], e = m[5], f = m[6];
		const g = m[8], h = m[9], i = m[10];
		return a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
	}

	function transformPoint(m, x, y, z) {
		return [
			m[0] * x + m[4] * y + m[8] * z + m[12],
			m[1] * x + m[5] * y + m[9] * z + m[13],
			m[2] * x + m[6] * y + m[10] * z + m[14],
		];
	}

	function transformDir(nm, x, y, z) {
		return [
			nm[0] * x + nm[3] * y + nm[6] * z,
			nm[1] * x + nm[4] * y + nm[7] * z,
			nm[2] * x + nm[5] * y + nm[8] * z,
		];
	}

	function normalMatrix3(m) {
		const a = m[0], b = m[1], c = m[2];
		const d = m[4], e = m[5], f = m[6];
		const g = m[8], h = m[9], i = m[10];
		const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
		if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
		const id = 1 / det;
		const inv = [
			(e * i - f * h) * id, -(b * i - c * h) * id, (b * f - c * e) * id,
			-(d * i - f * g) * id, (a * i - c * g) * id, -(a * f - c * d) * id,
			(d * h - e * g) * id, -(a * h - b * g) * id, (a * e - b * d) * id,
		];
		return [
			inv[0], inv[3], inv[6],
			inv[1], inv[4], inv[7],
			inv[2], inv[5], inv[8],
		];
	}


	function tryPackShelf(entries, size) {
		let x = 0, y = 0, shelfH = 0;
		const rects = new Array(entries.length);
		for (let i = 0; i < entries.length; i++) {
			const e = entries[i];
			if (e.w > size || e.h > size) return null;
			if (x + e.w > size) { x = 0; y += shelfH; shelfH = 0; }
			if (y + e.h > size) return null;
			rects[e.order] = { x: x, y: y, w: e.w, h: e.h };
			x += e.w;
			if (e.h > shelfH) shelfH = e.h;
		}
		return rects;
	}

	function packAtlas(sizes, maxSize) {
		const entries = sizes.map((s, i) => ({ w: s[0], h: s[1], order: i }));
		entries.sort((a, b) => b.h - a.h || b.w - a.w);
		let size = 64;
		while (size <= maxSize) {
			const rects = tryPackShelf(entries, size);
			if (rects) return { size: size, rects: rects };
			size *= 2;
		}
		return null;
	}

	function buildMaterials(gl, texRefs, settings, overrides) {
		const slotList = [{ texture: null, uuid: '__none__' }];
		const slotOfUuid = new Map();
		for (let i = 0; i < texRefs.length; i++) {
			const tex = texRefs[i];
			if (!tex) continue;
			if (!slotOfUuid.has(tex.uuid)) {
				slotOfUuid.set(tex.uuid, slotList.length);
				slotList.push({ texture: tex, uuid: tex.uuid });
			}
		}

		const maxTexSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096, 8192);
		const sizes = [];
		slotList.forEach(slot => {
			const tex = slot.texture;
			slot.color = null; slot.mer = null; slot.normal = null;
			slot.side = 'double';
			if (!tex) { sizes.push([1, 1]); return; }

			let group = null;
			try { group = tex.getGroup ? tex.getGroup() : null; } catch (err) { group = null; }

			let colorTex = tex, merTex = null, nrmTex = null;
			if (group && group.is_material) {
				const list = group.getTextures();
				colorTex = list.find(t => t.pbr_channel === 'color') || tex;
				merTex = list.find(t => t.pbr_channel === 'mer') || null;
				nrmTex = list.find(t => t.pbr_channel === 'normal') || null;
			}

			slot.color = textureSource(colorTex);
			slot.mer = textureSource(merTex);
			slot.normal = textureSource(nrmTex);
			slot.colorTex = colorTex;
			slot.group = group;
			slot.side = getMaterialSide(colorTex || tex, settings.render_sides);

			let w = slot.color ? slot.color.width : 1;
			let h = slot.color ? slot.color.height : 1;
			if (slot.mer) { w = Math.max(w, slot.mer.width); h = Math.max(h, slot.mer.height); }
			if (slot.normal) { w = Math.max(w, slot.normal.width); h = Math.max(h, slot.normal.height); }
			w = clamp(w | 0, 1, maxTexSize);
			h = clamp(h | 0, 1, maxTexSize);
			sizes.push([w, h]);
		});

		const packed = packAtlas(sizes, maxTexSize);
		if (!packed) throw new Error('纹理图集打包失败：贴图总面积超出 GPU 上限。');

		const S = packed.size;
		const mk = () => {
			const c = document.createElement('canvas');
			c.width = S; c.height = S;
			const ctx = c.getContext('2d', { willReadFrequently: true });
			ctx.imageSmoothingEnabled = false;
			return { canvas: c, ctx: ctx, used: false };
		};
		const atlasC = mk(), atlasM = mk(), atlasN = mk();
		atlasN.ctx.fillStyle = '#8080ff';
		atlasN.ctx.fillRect(0, 0, S, S);
		atlasM.ctx.fillStyle = '#000000';
		atlasM.ctx.fillRect(0, 0, S, S);
		atlasC.ctx.clearRect(0, 0, S, S);

		slotList.forEach((slot, i) => {
			const r = packed.rects[i];
			slot.rect = r;
			try {
				if (slot.color) {
					atlasC.ctx.clearRect(r.x, r.y, r.w, r.h);
					atlasC.ctx.drawImage(slot.color, r.x, r.y, r.w, r.h);
					atlasC.used = true;
				}
				if (slot.mer) { atlasM.ctx.drawImage(slot.mer, r.x, r.y, r.w, r.h); atlasM.used = true; }
				if (slot.normal) { atlasN.ctx.drawImage(slot.normal, r.x, r.y, r.w, r.h); atlasN.used = true; }
			} catch (err) {
				console.warn('[PathTracer] 绘制图集失败', err);
			}
		});

		const emissiveSlots = new Set();
		if (atlasM.used) {
			const merData = atlasM.ctx.getImageData(0, 0, S, S).data;
			slotList.forEach((slot, i) => {
				if (!slot.mer) return;
				const r = slot.rect;
				let found = false;
				for (let y = r.y; y < r.y + r.h && !found; y++) {
					for (let x = r.x; x < r.x + r.w; x++) {
						if (merData[(y * S + x) * 4 + 1] > 4) { found = true; break; }
					}
				}
				if (found) emissiveSlots.add(i);
			});
		}

		const texColor = createAtlasTexture(gl, atlasC.ctx.getImageData(0, 0, S, S).data, S, S);
		const texMER = atlasM.used ? createAtlasTexture(gl, atlasM.ctx.getImageData(0, 0, S, S).data, S, S) : null;
		const texNRM = atlasN.used ? createAtlasTexture(gl, atlasN.ctx.getImageData(0, 0, S, S).data, S, S) : null;

		const matData = new Float32Array(slotList.length * MAT_TEXELS * 4);
		slotList.forEach((slot, i) => {
			const o = i * MAT_TEXELS * 4;
			const tex = slot.texture;
			const ov = (tex && overrides && overrides[tex.uuid]) || {};

			const hasMER = !!slot.mer;
			const fullbrightTex = !!(tex && (tex.render_mode === 'emissive' || tex.render_mode === 'additive'));
			const defEmis = (hasMER || fullbrightTex) ? 1 : 0;
			const emisVal = (ov.emissive != null ? ov.emissive : defEmis) * settings.emissive_strength;

			let flags = 0;
			if (slot.color) flags |= MF_HAS_COLOR;
			if (hasMER) flags |= MF_HAS_MER;
			if (slot.normal) flags |= MF_HAS_NORMAL;
			if (!hasMER && emisVal > 0) flags |= MF_FULLBRIGHT;
			if (tex && tex.render_mode === 'additive') flags |= MF_ADDITIVE;
			if (!tex || tex.wrap_mode !== 'clamp') flags |= MF_WRAP_REPEAT;

			const tint = ov.color ? hexToLinear(ov.color) : (slot.color ? [1, 1, 1] : [0.8, 0.8, 0.8]);
			matData[o] = tint[0];
			matData[o + 1] = tint[1];
			matData[o + 2] = tint[2];
			matData[o + 3] = flags;

			matData[o + 4] = slot.rect.x;
			matData[o + 5] = slot.rect.y;
			matData[o + 6] = slot.rect.w;
			matData[o + 7] = slot.rect.h;

			matData[o + 8] = ov.roughness != null ? ov.roughness : settings.def_roughness;
			matData[o + 9] = ov.metalness != null ? ov.metalness : settings.def_metalness;
			matData[o + 10] = emisVal;
			matData[o + 11] = ov.ior != null ? ov.ior : 1.5;

			matData[o + 12] = ov.transmission != null ? ov.transmission : 0;
			matData[o + 13] = ov.alpha_cutoff != null ? ov.alpha_cutoff : settings.alpha_cutoff;
			matData[o + 14] = ov.normal_scale != null ? ov.normal_scale : 1;
			const amode = ov.alpha_mode || settings.alpha_mode || 'cutout';
			matData[o + 15] = amode === 'blend' ? 2 : (amode === 'opaque' ? 0 : 1);

			slot.emissive = emisVal > 0 && (hasMER ? emissiveSlots.has(i) : true);
		});

		return {
			slotList: slotList,
			slotOfUuid: slotOfUuid,
			matData: matData,
			matCount: slotList.length,
			atlasColor: texColor,
			atlasMER: texMER,
			atlasNormal: texNRM,
			atlasSize: S,
		};
	}


	function parseHDR(buffer) {
		const bytes = new Uint8Array(buffer);
		let pos = 0;

		function readLine() {
			let line = '';
			while (pos < bytes.length) {
				const c = bytes[pos++];
				if (c === 0x0a) break;
				line += String.fromCharCode(c);
			}
			return line;
		}

		const magic = readLine();
		if (!/^#\?(RADIANCE|RGBE)/.test(magic)) throw new Error('不是有效的 Radiance HDR 文件');

		let line;
		while ((line = readLine()).length > 0) { }

		const dims = readLine().trim().match(/^-Y\s+(\d+)\s+\+X\s+(\d+)$/);
		if (!dims) throw new Error('不支持的 HDR 扫描线顺序（仅支持 -Y +X）');
		const height = parseInt(dims[1], 10);
		const width = parseInt(dims[2], 10);

		const rgbe = new Uint8Array(width * height * 4);
		const scanline = new Uint8Array(width * 4);

		for (let y = 0; y < height; y++) {
			if (pos + 4 > bytes.length) throw new Error('HDR 数据意外结束');
			const b0 = bytes[pos], b1 = bytes[pos + 1], b2 = bytes[pos + 2], b3 = bytes[pos + 3];
			const isRLE = (b0 === 2 && b1 === 2 && ((b2 << 8) | b3) === width && width >= 8 && width < 32768);

			if (!isRLE) {
				for (let x = 0; x < width; x++) {
					const o = (y * width + x) * 4;
					rgbe[o] = bytes[pos++];
					rgbe[o + 1] = bytes[pos++];
					rgbe[o + 2] = bytes[pos++];
					rgbe[o + 3] = bytes[pos++];
				}
				continue;
			}

			pos += 4;
			for (let c = 0; c < 4; c++) {
				let x = 0;
				while (x < width) {
					let count = bytes[pos++];
					if (count > 128) {
						count -= 128;
						const value = bytes[pos++];
						for (let i = 0; i < count; i++) scanline[(x++) * 4 + c] = value;
					} else {
						for (let i = 0; i < count; i++) scanline[(x++) * 4 + c] = bytes[pos++];
					}
				}
			}
			for (let x = 0; x < width; x++) {
				const o = (y * width + x) * 4;
				rgbe[o] = scanline[x * 4];
				rgbe[o + 1] = scanline[x * 4 + 1];
				rgbe[o + 2] = scanline[x * 4 + 2];
				rgbe[o + 3] = scanline[x * 4 + 3];
			}
		}

		const data = new Float32Array(width * height * 4);
		for (let i = 0; i < width * height; i++) {
			const e = rgbe[i * 4 + 3];
			const scale = e ? Math.pow(2, e - 136) : 0;
			data[i * 4] = rgbe[i * 4] * scale;
			data[i * 4 + 1] = rgbe[i * 4 + 1] * scale;
			data[i * 4 + 2] = rgbe[i * 4 + 2] * scale;
			data[i * 4 + 3] = 1;
		}
		return { width: width, height: height, data: data };
	}

	function resampleEquirect(src, w, h) {
		const out = new Float32Array(w * h * 4);
		const sw = src.width, sh = src.height;
		for (let y = 0; y < h; y++) {
			const sy = ((y + 0.5) / h) * sh - 0.5;
			const y0 = Math.floor(sy);
			const fy = sy - y0;
			const ya = clamp(y0, 0, sh - 1), yb = clamp(y0 + 1, 0, sh - 1);
			for (let x = 0; x < w; x++) {
				const sx = ((x + 0.5) / w) * sw - 0.5;
				const x0 = Math.floor(sx);
				const fx = sx - x0;
				const xa = ((x0 % sw) + sw) % sw, xb = ((x0 + 1) % sw + sw) % sw;
				const o = (y * w + x) * 4;
				for (let c = 0; c < 3; c++) {
					const v00 = src.data[(ya * sw + xa) * 4 + c];
					const v10 = src.data[(ya * sw + xb) * 4 + c];
					const v01 = src.data[(yb * sw + xa) * 4 + c];
					const v11 = src.data[(yb * sw + xb) * 4 + c];
					out[o + c] = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
				}
				out[o + 3] = 1;
			}
		}
		for (let i = 0; i < out.length; i++) if (out[i] > 60000) out[i] = 60000;
		return out;
	}

	function generateSkyPixels(settings) {
		const w = ENV_W, h = ENV_H;
		const out = new Float32Array(w * h * 4);
		const mode = settings.env_mode;

		const zen = hexToLinear(settings.sky_zenith);
		const hor = hexToLinear(settings.sky_horizon);
		const gnd = hexToLinear(settings.sky_ground);
		const gTop = hexToLinear(settings.grad_top);
		const gBot = hexToLinear(settings.grad_bottom);
		const solid = hexToLinear(settings.solid_color);
		const sunCol = hexToLinear(settings.sun_color);
		const haze = clamp(settings.sky_haze, 0, 1);
		const sun = sunDirection(settings);
		const glowPower = 8 + 260 * (1 - haze);
		const glowStrength = 0.35 + 2.5 * haze;

		for (let y = 0; y < h; y++) {
			const theta = ((y + 0.5) / h) * Math.PI;
			const sinT = Math.sin(theta), cosT = Math.cos(theta);
			for (let x = 0; x < w; x++) {
				const phi = ((x + 0.5) / w - 0.5) * 2 * Math.PI;
				const dx = sinT * Math.cos(phi);
				const dy = cosT;
				const dz = sinT * Math.sin(phi);
				const o = (y * w + x) * 4;
				let r = 0, g = 0, b = 0;

				if (mode === 'solid') {
					r = solid[0]; g = solid[1]; b = solid[2];
				} else if (mode === 'gradient') {
					const t = clamp(dy * 0.5 + 0.5, 0, 1);
					r = gBot[0] + (gTop[0] - gBot[0]) * t;
					g = gBot[1] + (gTop[1] - gBot[1]) * t;
					b = gBot[2] + (gTop[2] - gBot[2]) * t;
				} else {
					if (dy >= 0) {
						const t = Math.pow(dy, 0.55);
						r = hor[0] + (zen[0] - hor[0]) * t;
						g = hor[1] + (zen[1] - hor[1]) * t;
						b = hor[2] + (zen[2] - hor[2]) * t;
					} else {
						const t = Math.pow(-dy, 0.4);
						r = hor[0] * 0.55 + (gnd[0] - hor[0] * 0.55) * t;
						g = hor[1] * 0.55 + (gnd[1] - hor[1] * 0.55) * t;
						b = hor[2] * 0.55 + (gnd[2] - hor[2] * 0.55) * t;
					}
					const cosA = dx * sun[0] + dy * sun[1] + dz * sun[2];
					if (cosA > 0 && settings.sun_enable && settings.sun_intensity > 0) {
						const glow = Math.pow(cosA, glowPower) * glowStrength;
						r += sunCol[0] * glow;
						g += sunCol[1] * glow;
						b += sunCol[2] * glow;
					}
				}

				out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 1;
			}
		}
		return out;
	}

	function sunDirection(settings) {
		const el = settings.sun_elevation * Math.PI / 180;
		const az = settings.sun_azimuth * Math.PI / 180;
		const ce = Math.cos(el);
		return vNorm([ce * Math.cos(az), Math.sin(el), ce * Math.sin(az)]);
	}

	function buildEnvDistribution(pixels, w, h) {
		const DW = ENV_DIST_W, DH = ENV_DIST_H;
		const bx = Math.max(1, Math.floor(w / DW));
		const by = Math.max(1, Math.floor(h / DH));

		const lum = new Float32Array(DW * DH);
		let total = 0;
		for (let y = 0; y < DH; y++) {
			const theta = ((y + 0.5) / DH) * Math.PI;
			const sinT = Math.max(Math.sin(theta), 1e-4);
			for (let x = 0; x < DW; x++) {
				let acc = 0, n = 0;
				for (let sy = 0; sy < by; sy++) {
					const py = Math.min(h - 1, y * by + sy);
					for (let sx = 0; sx < bx; sx++) {
						const px = Math.min(w - 1, x * bx + sx);
						const o = (py * w + px) * 4;
						acc += 0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2];
						n++;
					}
				}
				const v = (acc / Math.max(n, 1)) * sinT;
				lum[y * DW + x] = v;
				total += v;
			}
		}

		const mean = total / (DW * DH);
		const eps = Math.max(mean * 0.06, 1e-8);
		total = 0;
		for (let i = 0; i < lum.length; i++) { lum[i] += eps; total += lum[i]; }
		if (total <= 0) { for (let i = 0; i < lum.length; i++) lum[i] = 1; total = lum.length; }

		const cond = new Float32Array((DW + 1) * DH);
		const rowSum = new Float32Array(DH);
		for (let y = 0; y < DH; y++) {
			let acc = 0;
			for (let x = 0; x < DW; x++) acc += lum[y * DW + x];
			rowSum[y] = acc;
			const base = y * (DW + 1);
			let run = 0;
			cond[base] = 0;
			for (let x = 0; x < DW; x++) {
				run += lum[y * DW + x];
				cond[base + x + 1] = acc > 0 ? run / acc : (x + 1) / DW;
			}
			cond[base + DW] = 1;
		}

		const marg = new Float32Array(DH + 1);
		let sum = 0;
		for (let y = 0; y < DH; y++) sum += rowSum[y];
		let run = 0;
		marg[0] = 0;
		for (let y = 0; y < DH; y++) {
			run += rowSum[y];
			marg[y + 1] = sum > 0 ? run / sum : (y + 1) / DH;
		}
		marg[DH] = 1;

		return { cond: cond, marg: marg, width: DW, height: DH };
	}


	const VS_FULLSCREEN = `#version 300 es
void main() {
	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

	const FS_PATHTRACE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

#define PI 3.141592653589793
#define INV_PI 0.3183098861837907
#define TFAR 1.0e20
#define RAY_EPS 1.0e-3

#define MF_HAS_COLOR   1
#define MF_HAS_MER     2
#define MF_HAS_NORMAL  4
#define MF_FULLBRIGHT  8
#define MF_WRAP_REPEAT 16
#define MF_ADDITIVE    32

uniform vec2 uResolution;
uniform int  uSeed;
uniform int  uMaxBounce;
uniform float uClamp;
uniform int  uFilterLinear;

uniform vec3 uCamPos, uCamRight, uCamUp, uCamForward;
uniform float uTanHalfFov, uAspect, uOrthoHalfHeight;
uniform int  uOrtho;
uniform float uAperture, uFocusDist;

uniform sampler2D uTriPos;
uniform sampler2D uTriAttr;
uniform sampler2D uBVH;
uniform sampler2D uMat;
uniform sampler2D uAtlasC;
uniform sampler2D uAtlasM;
uniform sampler2D uAtlasN;
uniform sampler2D uLightTex;
uniform int uTriPosW, uTriAttrW, uBVHW, uMatW, uLightW;
uniform int uTriCount, uLightCount;

uniform sampler2D uEnv;
uniform sampler2D uEnvCond;
uniform sampler2D uEnvMarg;
uniform ivec2 uEnvDist;
uniform float uEnvIntensity, uEnvRotation;
uniform int uBgMode;
uniform vec3 uBgColor;

uniform int  uSunEnable;
uniform vec3 uSunDir;
uniform float uSunCosRadius, uSunSolidAngle;
uniform vec3 uSunRadiance;

uniform int  uGroundOn, uGroundCatcher;
uniform float uGroundY, uGroundRough, uGroundMetal, uGroundRadius;
uniform vec3 uGroundColor;

uniform sampler2D uAccum;
uniform sampler2D uAccumAlb;
uniform sampler2D uAccumNrm;
uniform sampler2D uAccumMom;
uniform int uReset;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outAlbedo;
layout(location = 2) out vec4 outNormal;
layout(location = 3) out vec4 outMoment;

uint g_rng;
uint pcgNext() {
	g_rng = g_rng * 747796405u + 2891336453u;
	uint w = ((g_rng >> ((g_rng >> 28u) + 4u)) ^ g_rng) * 277803737u;
	return (w >> 22u) ^ w;
}
float rnd() { return float(pcgNext()) * (1.0 / 4294967296.0); }
vec2 rnd2() { return vec2(rnd(), rnd()); }

vec4 fetchAt(sampler2D s, int idx, int w) {
	return texelFetch(s, ivec2(idx - (idx / w) * w, idx / w), 0);
}
vec4 fTri(int i) { return fetchAt(uTriPos, i, uTriPosW); }
vec4 fAttr(int i) { return fetchAt(uTriAttr, i, uTriAttrW); }
vec4 fBVH(int i) { return fetchAt(uBVH, i, uBVHW); }
vec4 fMat(int i) { return fetchAt(uMat, i, uMatW); }

struct Mat {
	vec3 tint;
	int flags;
	vec4 rect;
	float rough, metal, emis, ior;
	float transm, cutoff, nscale;
	int amode;
};

Mat loadMat(int id) {
	vec4 m0 = fMat(id * 4 + 0);
	vec4 m1 = fMat(id * 4 + 1);
	vec4 m2 = fMat(id * 4 + 2);
	vec4 m3 = fMat(id * 4 + 3);
	Mat m;
	m.tint = m0.rgb;
	m.flags = int(m0.a + 0.5);
	m.rect = m1;
	m.rough = m2.x; m.metal = m2.y; m.emis = m2.z; m.ior = m2.w;
	m.transm = m3.x; m.cutoff = m3.y; m.nscale = m3.z;
	m.amode = int(m3.w + 0.5);
	return m;
}

vec3 srgbToLin(vec3 c) {
	return mix(c / 12.92, pow(max(c + 0.055, vec3(0.0)) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

vec4 fetchAtlas(sampler2D atlas, vec4 rect, vec2 f, bool rep) {
	vec2 sz = max(rect.zw, vec2(1.0));
	if (rep) f = mod(f, sz);
	f = clamp(f, vec2(0.0), sz - 1.0);
	return texelFetch(atlas, ivec2(rect.xy + f), 0);
}

vec4 sampleAtlas(sampler2D atlas, vec4 rect, vec2 uvIn, bool rep) {
	vec2 uv = vec2(uvIn.x, 1.0 - uvIn.y);
	vec2 sz = max(rect.zw, vec2(1.0));
	if (uFilterLinear == 0) {
		return fetchAtlas(atlas, rect, floor(uv * sz), rep);
	}
	vec2 t = uv * sz - 0.5;
	vec2 f0 = floor(t);
	vec2 fr = t - f0;
	vec4 c00 = fetchAtlas(atlas, rect, f0, rep);
	vec4 c10 = fetchAtlas(atlas, rect, f0 + vec2(1.0, 0.0), rep);
	vec4 c01 = fetchAtlas(atlas, rect, f0 + vec2(0.0, 1.0), rep);
	vec4 c11 = fetchAtlas(atlas, rect, f0 + vec2(1.0, 1.0), rep);
	return mix(mix(c00, c10, fr.x), mix(c01, c11, fr.x), fr.y);
}

struct Hit {
	float t;
	int tri;
	vec2 bc;
};

bool hitAABB(vec3 bmin, vec3 bmax, vec3 ro, vec3 invD, float tmax) {
	vec3 t0 = (bmin - ro) * invD;
	vec3 t1 = (bmax - ro) * invD;
	vec3 ts = min(t0, t1);
	vec3 tb = max(t0, t1);
	float tn = max(max(ts.x, ts.y), max(ts.z, 0.0));
	float tf = min(min(tb.x, tb.y), min(tb.z, tmax));
	return tn <= tf;
}

void triIntersect(int i, vec3 ro, vec3 rd, inout Hit hit) {
	vec3 v0 = fTri(i * 3 + 0).xyz;
	vec4 p1 = fTri(i * 3 + 1);
	vec3 v1 = p1.xyz;
	vec3 v2 = fTri(i * 3 + 2).xyz;
	vec3 e1 = v1 - v0;
	vec3 e2 = v2 - v0;
	vec3 pv = cross(rd, e2);
	float det = dot(e1, pv);
	int cull = int(p1.w + 0.5);
	if (cull == 1 && det <= 0.0) return;
	if (cull == 2 && det >= 0.0) return;
	if (abs(det) < 1e-12) return;
	float inv = 1.0 / det;
	vec3 tv = ro - v0;
	float u = dot(tv, pv) * inv;
	if (u < 0.0 || u > 1.0) return;
	vec3 qv = cross(tv, e1);
	float v = dot(rd, qv) * inv;
	if (v < 0.0 || u + v > 1.0) return;
	float t = dot(e2, qv) * inv;
	if (t > 1e-4 && t < hit.t) {
		hit.t = t; hit.tri = i; hit.bc = vec2(u, v);
	}
}

vec3 safeInvDir(vec3 d) {
	const float e = 1e-9;
	vec3 s = vec3(d.x < 0.0 ? -e : e, d.y < 0.0 ? -e : e, d.z < 0.0 ? -e : e);
	vec3 dd = vec3(abs(d.x) < e ? s.x : d.x, abs(d.y) < e ? s.y : d.y, abs(d.z) < e ? s.z : d.z);
	return 1.0 / dd;
}

void intersectBVH(vec3 ro, vec3 rd, inout Hit hit) {
	if (uTriCount == 0) return;
	vec3 invD = safeInvDir(rd);
	int stack[32];
	int sp = 0;
	stack[sp++] = 0;
	for (int guard = 0; guard < 4096; guard++) {
		if (sp <= 0) break;
		int node = stack[--sp];
		vec4 a = fBVH(node * 2);
		vec4 b = fBVH(node * 2 + 1);
		if (!hitAABB(a.xyz, b.xyz, ro, invD, hit.t)) continue;
		int count = int(b.w + 0.5);
		if (count > 0) {
			int start = int(a.w + 0.5);
			for (int i = 0; i < count; i++) triIntersect(start + i, ro, rd, hit);
		} else if (sp <= 30) {
			int left = int(a.w + 0.5);
			stack[sp++] = left + 1;
			stack[sp++] = left;
		}
	}
}

void intersectGround(vec3 ro, vec3 rd, inout Hit hit) {
	if (uGroundOn == 0) return;
	if (abs(rd.y) < 1e-7) return;
	float t = (uGroundY - ro.y) / rd.y;
	if (t <= 1e-4 || t >= hit.t) return;
	vec3 p = ro + rd * t;
	if (uGroundRadius > 0.0 && dot(p.xz, p.xz) > uGroundRadius * uGroundRadius) return;
	hit.t = t; hit.tri = -2; hit.bc = vec2(0.0);
}

void intersectScene(vec3 ro, vec3 rd, inout Hit hit) {
	intersectGround(ro, rd, hit);
	intersectBVH(ro, rd, hit);
}

struct Surface {
	vec3 pos, ng, ns;
	vec2 uv;
	vec3 albedo;
	float alpha, rough, metal, transm, ior, cutoff;
	int amode;
	vec3 emission;
	bool isLight;
};

void triVerts(int i, out vec3 v0, out vec3 v1, out vec3 v2) {
	v0 = fTri(i * 3 + 0).xyz;
	v1 = fTri(i * 3 + 1).xyz;
	v2 = fTri(i * 3 + 2).xyz;
}

vec2 triUV(int i, vec2 bc) {
	vec4 a0 = fAttr(i * 4 + 0);
	vec4 a1 = fAttr(i * 4 + 1);
	vec4 a2 = fAttr(i * 4 + 2);
	vec4 a3 = fAttr(i * 4 + 3);
	vec2 uv0 = vec2(a0.w, a1.w);
	vec2 uv1 = vec2(a2.w, a3.x);
	vec2 uv2 = vec2(a3.y, a3.z);
	float w = 1.0 - bc.x - bc.y;
	return uv0 * w + uv1 * bc.x + uv2 * bc.y;
}

Mat matOfTri(int i) {
	return loadMat(int(fTri(i * 3 + 0).w + 0.5));
}

float alphaOfTri(int i, vec2 bc, Mat m) {
	if ((m.flags & MF_HAS_COLOR) == 0) return 1.0;
	vec2 uv = triUV(i, bc);
	bool rep = (m.flags & MF_WRAP_REPEAT) != 0;
	return sampleAtlas(uAtlasC, m.rect, uv, rep).a;
}

bool alphaPassThrough(Mat m, float alpha) {
	if (m.amode == 0) return false;
	if (m.amode == 1) return alpha < m.cutoff;
	return rnd() >= alpha;
}

vec3 triEmission(int i, vec2 bc) {
	int matId = int(fTri(i * 3 + 0).w + 0.5);
	Mat m = loadMat(matId);
	vec2 uv = triUV(i, bc);
	bool rep = (m.flags & MF_WRAP_REPEAT) != 0;
	vec3 base = m.tint;
	if ((m.flags & MF_HAS_COLOR) != 0) base *= srgbToLin(sampleAtlas(uAtlasC, m.rect, uv, rep).rgb);
	if ((m.flags & MF_HAS_MER) != 0) {
		float e = sampleAtlas(uAtlasM, m.rect, uv, rep).g;
		return base * e * m.emis;
	}
	if ((m.flags & MF_FULLBRIGHT) != 0) return base * m.emis;
	return vec3(0.0);
}

void onb(vec3 n, out vec3 t, out vec3 b) {
	float s = n.z >= 0.0 ? 1.0 : -1.0;
	float a = -1.0 / (s + n.z);
	float bb = n.x * n.y * a;
	t = vec3(1.0 + s * n.x * n.x * a, s * bb, -s * n.x);
	b = vec3(bb, s + n.y * n.y * a, -n.y);
}

Surface getSurface(Hit hit, vec3 ro, vec3 rd) {
	Surface s;
	s.pos = ro + rd * hit.t;
	s.isLight = false;
	s.transm = 0.0;
	s.ior = 1.5;
	s.cutoff = 0.0;
	s.alpha = 1.0;
	s.amode = 0;
	s.emission = vec3(0.0);

	if (hit.tri == -2) {
		s.ng = vec3(0.0, 1.0, 0.0);
		s.ns = s.ng;
		s.uv = vec2(0.0);
		s.albedo = uGroundColor;
		s.rough = uGroundRough;
		s.metal = uGroundMetal;
		if (rd.y > 0.0) { s.ng = -s.ng; s.ns = -s.ns; }
		return s;
	}

	int i = hit.tri;
	vec3 v0, v1, v2;
	triVerts(i, v0, v1, v2);
	vec3 geoN = normalize(cross(v1 - v0, v2 - v0));

	vec4 a0 = fAttr(i * 4 + 0);
	vec4 a1 = fAttr(i * 4 + 1);
	vec4 a2 = fAttr(i * 4 + 2);
	vec4 a3 = fAttr(i * 4 + 3);
	float w = 1.0 - hit.bc.x - hit.bc.y;
	vec3 sn = a0.xyz * w + a1.xyz * hit.bc.x + a2.xyz * hit.bc.y;
	if (dot(sn, sn) < 1e-12) sn = geoN; else sn = normalize(sn);
	if (dot(sn, geoN) < 0.0) geoN = -geoN;

	vec2 uv0 = vec2(a0.w, a1.w);
	vec2 uv1 = vec2(a2.w, a3.x);
	vec2 uv2 = vec2(a3.y, a3.z);
	s.uv = uv0 * w + uv1 * hit.bc.x + uv2 * hit.bc.y;
	s.isLight = a3.w > 0.5;

	if (dot(geoN, rd) > 0.0) { geoN = -geoN; sn = -sn; }
	s.ng = geoN;
	s.ns = sn;

	int matId = int(fTri(i * 3 + 0).w + 0.5);
	Mat m = loadMat(matId);
	bool rep = (m.flags & MF_WRAP_REPEAT) != 0;

	vec3 base = m.tint;
	float alpha = 1.0;
	if ((m.flags & MF_HAS_COLOR) != 0) {
		vec4 c = sampleAtlas(uAtlasC, m.rect, s.uv, rep);
		base *= srgbToLin(c.rgb);
		alpha = c.a;
	}
	s.albedo = base;
	s.alpha = alpha;
	s.cutoff = m.cutoff;
	s.amode = m.amode;
	s.rough = clamp(m.rough, 0.015, 1.0);
	s.metal = clamp(m.metal, 0.0, 1.0);
	s.transm = clamp(m.transm, 0.0, 1.0);
	s.ior = max(m.ior, 1.001);

	if ((m.flags & MF_HAS_MER) != 0) {
		vec3 mer = sampleAtlas(uAtlasM, m.rect, s.uv, rep).rgb;
		s.metal = clamp(mer.r, 0.0, 1.0);
		s.rough = clamp(mer.b, 0.015, 1.0);
		s.emission = base * mer.g * m.emis;
	} else if ((m.flags & MF_FULLBRIGHT) != 0) {
		s.emission = base * m.emis;
	}

	if ((m.flags & MF_HAS_NORMAL) != 0 && m.nscale > 0.0) {
		vec2 d1 = uv1 - uv0;
		vec2 d2 = uv2 - uv0;
		float r = d1.x * d2.y - d2.x * d1.y;
		if (abs(r) > 1e-9) {
			vec3 e1 = v1 - v0;
			vec3 e2 = v2 - v0;
			vec3 T = (e1 * d2.y - e2 * d1.y) / r;
			T = normalize(T - s.ns * dot(s.ns, T));
			if (dot(T, T) > 0.5) {
				vec3 B = cross(s.ns, T);
				vec3 nt = sampleAtlas(uAtlasN, m.rect, s.uv, rep).rgb * 2.0 - 1.0;
				nt.xy *= m.nscale;
				vec3 mapped = normalize(T * nt.x + B * nt.y + s.ns * max(nt.z, 0.05));
				if (dot(mapped, s.ng) > 0.0) s.ns = mapped;
			}
		}
	}
	return s;
}

vec2 dirToEnvUV(vec3 d) {
	float phi = atan(d.z, d.x) + uEnvRotation;
	float u = fract(phi * 0.15915494309189535 + 0.5);
	float v = acos(clamp(d.y, -1.0, 1.0)) * INV_PI;
	return vec2(u, clamp(v, 0.0, 1.0));
}

vec3 envRadiance(vec3 d) {
	return texture(uEnv, dirToEnvUV(d)).rgb * uEnvIntensity;
}

float envPdfDir(vec3 d) {
	int W = uEnvDist.x, H = uEnvDist.y;
	vec2 uv = dirToEnvUV(d);
	int x = clamp(int(uv.x * float(W)), 0, W - 1);
	int y = clamp(int(uv.y * float(H)), 0, H - 1);
	float pm = (texelFetch(uEnvMarg, ivec2(y + 1, 0), 0).r - texelFetch(uEnvMarg, ivec2(y, 0), 0).r) * float(H);
	float pc = (texelFetch(uEnvCond, ivec2(x + 1, y), 0).r - texelFetch(uEnvCond, ivec2(x, y), 0).r) * float(W);
	float sinT = sqrt(max(0.0, 1.0 - d.y * d.y));
	if (sinT < 1e-5) return 0.0;
	return (pm * pc) / (2.0 * PI * PI * sinT);
}

vec3 envSampleDir(out vec3 L, out float pdf) {
	int W = uEnvDist.x, H = uEnvDist.y;
	float r1 = rnd(), r2 = rnd();
	int lo = 0, hi = H;
	for (int i = 0; i < 12; i++) {
		if (lo + 1 >= hi) break;
		int mid = (lo + hi) >> 1;
		if (texelFetch(uEnvMarg, ivec2(mid, 0), 0).r <= r1) lo = mid; else hi = mid;
	}
	int y = lo;
	float m0 = texelFetch(uEnvMarg, ivec2(y, 0), 0).r;
	float m1 = texelFetch(uEnvMarg, ivec2(y + 1, 0), 0).r;
	float dy = (m1 > m0) ? (r1 - m0) / (m1 - m0) : 0.5;

	lo = 0; hi = W;
	for (int i = 0; i < 12; i++) {
		if (lo + 1 >= hi) break;
		int mid = (lo + hi) >> 1;
		if (texelFetch(uEnvCond, ivec2(mid, y), 0).r <= r2) lo = mid; else hi = mid;
	}
	int x = lo;
	float c0 = texelFetch(uEnvCond, ivec2(x, y), 0).r;
	float c1 = texelFetch(uEnvCond, ivec2(x + 1, y), 0).r;
	float dx = (c1 > c0) ? (r2 - c0) / (c1 - c0) : 0.5;

	float u = (float(x) + dx) / float(W);
	float v = (float(y) + dy) / float(H);
	float theta = v * PI;
	float phi = (u - 0.5) * 2.0 * PI - uEnvRotation;
	float sinT = sin(theta);
	L = vec3(sinT * cos(phi), cos(theta), sinT * sin(phi));
	float pm = (m1 - m0) * float(H);
	float pc = (c1 - c0) * float(W);
	pdf = (sinT > 1e-5) ? (pm * pc) / (2.0 * PI * PI * sinT) : 0.0;
	return envRadiance(L);
}

vec3 sunRadianceFor(vec3 d) {
	if (uSunEnable == 0) return vec3(0.0);
	return dot(d, uSunDir) >= uSunCosRadius ? uSunRadiance : vec3(0.0);
}
float sunPdfFor(vec3 d) {
	if (uSunEnable == 0) return 0.0;
	return dot(d, uSunDir) >= uSunCosRadius ? (1.0 / uSunSolidAngle) : 0.0;
}
vec3 sunSampleDir(out float pdf) {
	float cosT = mix(uSunCosRadius, 1.0, rnd());
	float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
	float phi = 2.0 * PI * rnd();
	vec3 t, b;
	onb(uSunDir, t, b);
	pdf = 1.0 / uSunSolidAngle;
	return normalize(t * (sinT * cos(phi)) + b * (sinT * sin(phi)) + uSunDir * cosT);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float powerHeuristic(float a, float b) {
	float aa = a * a, bb = b * b;
	return aa / max(aa + bb, 1e-9);
}
float specProb(vec3 albedo, float metal) {
	float ds = luma(albedo) * (1.0 - metal);
	float ss = luma(mix(vec3(0.04), albedo, metal)) + metal * 0.5;
	return clamp(ss / max(ds + ss, 1e-4), 0.12, 0.9);
}
float distGGX(float NoH, float a) {
	float a2 = a * a;
	float d = NoH * NoH * (a2 - 1.0) + 1.0;
	return a2 / max(PI * d * d, 1e-9);
}
float smithG(float NoV, float NoL, float a) {
	float a2 = a * a;
	float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
	float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
	return 0.5 / max(gv + gl, 1e-9);
}

vec3 bsdfEval(vec3 N, vec3 V, vec3 L, vec3 albedo, float rough, float metal, out float pdf) {
	pdf = 0.0;
	float NoL = dot(N, L);
	float NoV = dot(N, V);
	if (NoL <= 0.0 || NoV <= 0.0) return vec3(0.0);
	vec3 H = normalize(V + L);
	float NoH = max(dot(N, H), 0.0);
	float VoH = max(dot(V, H), 1e-5);
	float a = max(rough * rough, 1e-4);
	vec3 f0 = mix(vec3(0.04), albedo, metal);
	vec3 F = f0 + (1.0 - f0) * pow(clamp(1.0 - VoH, 0.0, 1.0), 5.0);
	float D = distGGX(NoH, a);
	float Vis = smithG(NoV, NoL, a);
	vec3 spec = F * D * Vis;
	vec3 diff = albedo * (1.0 - metal) * INV_PI;
	float ps = specProb(albedo, metal);
	float pdfS = D * NoH / (4.0 * VoH);
	float pdfD = NoL * INV_PI;
	pdf = mix(pdfD, pdfS, ps);
	return (diff + spec) * NoL;
}

vec3 cosineSample(vec3 n, vec2 u) {
	float r = sqrt(u.x);
	float phi = 2.0 * PI * u.y;
	vec3 t, b;
	onb(n, t, b);
	return normalize(t * (r * cos(phi)) + b * (r * sin(phi)) + n * sqrt(max(0.0, 1.0 - u.x)));
}

vec3 ggxSampleH(vec3 n, float a, vec2 u) {
	float phi = 2.0 * PI * u.x;
	float cosT = sqrt(max(0.0, (1.0 - u.y) / (1.0 + (a * a - 1.0) * u.y)));
	float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
	vec3 t, b;
	onb(n, t, b);
	return normalize(t * (sinT * cos(phi)) + b * (sinT * sin(phi)) + n * cosT);
}

bool bsdfSample(vec3 N, vec3 V, vec3 albedo, float rough, float metal, out vec3 L, out vec3 weight, out float pdf) {
	float ps = specProb(albedo, metal);
	float a = max(rough * rough, 1e-4);
	if (rnd() < ps) {
		vec3 H = ggxSampleH(N, a, rnd2());
		L = reflect(-V, H);
	} else {
		L = cosineSample(N, rnd2());
	}
	if (dot(N, L) <= 0.0) return false;
	vec3 f = bsdfEval(N, V, L, albedo, rough, metal, pdf);
	if (pdf <= 1e-8) return false;
	weight = f / pdf;
	return true;
}

float fresnelDielectric(float cosI, float eta) {
	float s2 = eta * eta * (1.0 - cosI * cosI);
	if (s2 > 1.0) return 1.0;
	float cosT = sqrt(max(0.0, 1.0 - s2));
	float rs = (eta * cosI - cosT) / (eta * cosI + cosT);
	float rp = (cosI - eta * cosT) / (cosI + eta * cosT);
	return 0.5 * (rs * rs + rp * rp);
}

bool anyHitBVH(vec3 ro, vec3 rd, float maxT) {
	if (uTriCount == 0) return false;
	vec3 invD = safeInvDir(rd);
	int stack[32];
	int sp = 0;
	stack[sp++] = 0;
	for (int guard = 0; guard < 4096; guard++) {
		if (sp <= 0) break;
		int node = stack[--sp];
		vec4 a = fBVH(node * 2);
		vec4 b = fBVH(node * 2 + 1);
		if (!hitAABB(a.xyz, b.xyz, ro, invD, maxT)) continue;
		int count = int(b.w + 0.5);
		if (count > 0) {
			int start = int(a.w + 0.5);
			for (int i = 0; i < count; i++) {
				Hit h;
				h.t = maxT;
				h.tri = -1;
				h.bc = vec2(0.0);
				triIntersect(start + i, ro, rd, h);
				if (h.tri >= 0) {
					Mat hm = matOfTri(h.tri);
					if (!alphaPassThrough(hm, alphaOfTri(h.tri, h.bc, hm))) return true;
				}
			}
		} else if (sp <= 30) {
			int left = int(a.w + 0.5);
			stack[sp++] = left + 1;
			stack[sp++] = left;
		}
	}
	return false;
}

bool occluded(vec3 ro, vec3 rd, float maxT, bool skipGround) {
	if (!skipGround && uGroundOn == 1) {
		Hit gh;
		gh.t = maxT;
		gh.tri = -1;
		gh.bc = vec2(0.0);
		intersectGround(ro, rd, gh);
		if (gh.tri == -2) return true;
	}
	return anyHitBVH(ro, rd, maxT);
}

struct LightSample { vec3 dir; vec3 radiance; float pdf; float dist; };

LightSample sampleTriLight(vec3 p) {
	LightSample ls;
	ls.dir = vec3(0.0, 1.0, 0.0);
	ls.radiance = vec3(0.0);
	ls.pdf = 0.0;
	ls.dist = 0.0;
	if (uLightCount == 0) return ls;

	int li = min(int(rnd() * float(uLightCount)), uLightCount - 1);
	int tri = int(texelFetch(uLightTex, ivec2(li - (li / uLightW) * uLightW, li / uLightW), 0).r + 0.5);
	vec3 v0, v1, v2;
	triVerts(tri, v0, v1, v2);
	float su = sqrt(rnd());
	float b0 = 1.0 - su;
	float b1 = rnd() * su;
	float b2 = max(0.0, 1.0 - b0 - b1);
	vec3 q = v0 * b0 + v1 * b1 + v2 * b2;
	vec3 cr = cross(v1 - v0, v2 - v0);
	float area2 = length(cr);
	if (area2 < 1e-9) return ls;
	vec3 nl = cr / area2;
	float area = 0.5 * area2;

	vec3 dv = q - p;
	float d2 = dot(dv, dv);
	if (d2 < 1e-8) return ls;
	float d = sqrt(d2);
	ls.dir = dv / d;
	ls.dist = d;
	float cosL = abs(dot(nl, ls.dir));
	if (cosL < 1e-5) return ls;
	ls.pdf = d2 / (cosL * area * float(uLightCount));
	ls.radiance = triEmission(tri, vec2(b1, b2));
	return ls;
}

float triLightPdf(int tri, vec3 from, vec3 hitP) {
	if (uLightCount == 0) return 0.0;
	vec3 v0, v1, v2;
	triVerts(tri, v0, v1, v2);
	vec3 cr = cross(v1 - v0, v2 - v0);
	float area2 = length(cr);
	if (area2 < 1e-9) return 0.0;
	vec3 nl = cr / area2;
	vec3 dv = hitP - from;
	float d2 = dot(dv, dv);
	float d = sqrt(max(d2, 1e-12));
	float cosL = abs(dot(nl, dv / d));
	if (cosL < 1e-5) return 0.0;
	return d2 / (cosL * 0.5 * area2 * float(uLightCount));
}

float shadowCatcherAlpha(vec3 p, vec3 n) {
	float full = 0.0, vis = 0.0;
	if (uSunEnable == 1) {
		float pdf;
		vec3 L = sunSampleDir(pdf);
		float ndl = max(dot(n, L), 0.0);
		if (ndl > 0.0 && pdf > 0.0) {
			float c = luma(uSunRadiance) * ndl / pdf;
			full += c;
			if (!occluded(p + n * RAY_EPS, L, TFAR, true)) vis += c;
		}
	}
	{
		vec3 L;
		float pdf;
		vec3 Le = envSampleDir(L, pdf);
		float ndl = max(dot(n, L), 0.0);
		if (ndl > 0.0 && pdf > 1e-8) {
			float c = luma(Le) * ndl / pdf;
			full += c;
			if (!occluded(p + n * RAY_EPS, L, TFAR, true)) vis += c;
		}
	}
	if (full <= 1e-8) return 0.0;
	return clamp(1.0 - vis / full, 0.0, 1.0);
}

vec3 tracePath(vec3 ro, vec3 rd, out float alphaOut, out vec3 gAlbedo, out vec3 gNormal, out float gDepth) {
	vec3 radiance = vec3(0.0);
	vec3 beta = vec3(1.0);
	float lastPdf = 0.0;
	bool specularPath = true;
	alphaOut = 1.0;
	gAlbedo = vec3(0.0);
	gNormal = vec3(0.0);
	gDepth = 1.0e6;
	bool gWritten = false;
	int bounce = 0;
	vec3 prevPos = ro;

	for (int iter = 0; iter < 96; iter++) {
		Hit hit;
		hit.t = TFAR;
		hit.tri = -1;
		hit.bc = vec2(0.0);
		intersectScene(ro, rd, hit);

		if (hit.tri == -1) {
			vec3 env = envRadiance(rd);
			vec3 sun = sunRadianceFor(rd);
			if (bounce == 0) {
				if (uBgMode == 1) { radiance += uBgColor; gAlbedo = uBgColor; }
				else if (uBgMode == 2) { alphaOut = 0.0; gAlbedo = vec3(0.0); }
				else { radiance += env + sun; gAlbedo = env; }
				gNormal = -rd;
			} else {
				float we = specularPath ? 1.0 : powerHeuristic(lastPdf, envPdfDir(rd));
				float ws = specularPath ? 1.0 : powerHeuristic(lastPdf, sunPdfFor(rd));
				radiance += beta * (env * we + sun * ws);
			}
			break;
		}

		Surface s = getSurface(hit, ro, rd);

		bool passThrough = false;
		if (s.amode == 1) passThrough = s.alpha < s.cutoff;
		else if (s.amode == 2) passThrough = rnd() >= s.alpha;
		if (passThrough) {
			ro = s.pos + rd * RAY_EPS;
			continue;
		}

		if (bounce == 0 && hit.tri == -2 && uGroundCatcher == 1) {
			alphaOut = shadowCatcherAlpha(s.pos, s.ng);
			gAlbedo = vec3(0.0);
			gNormal = s.ng;
			gDepth = hit.t;
			break;
		}

		if (!gWritten) {
			gAlbedo = s.albedo;
			gNormal = s.ns;
			gDepth = hit.t;
			gWritten = true;
		}

		if (dot(s.emission, s.emission) > 0.0) {
			float w = 1.0;
			if (!specularPath && s.isLight) {
				w = powerHeuristic(lastPdf, triLightPdf(hit.tri, prevPos, s.pos));
			}
			radiance += beta * s.emission * w;
		}

		if (bounce >= uMaxBounce) break;

		vec3 V = -rd;

		if (s.transm > 0.0 && rnd() < s.transm) {
			bool entering = dot(rd, s.ng) < 0.0;
			vec3 n = s.ng;
			float eta = entering ? (1.0 / s.ior) : s.ior;
			float cosI = clamp(dot(-rd, n), 0.0, 1.0);
			float F = fresnelDielectric(cosI, eta);
			vec3 newDir;
			if (rnd() < F) {
				newDir = reflect(rd, n);
			} else {
				newDir = refract(rd, n, eta);
				if (dot(newDir, newDir) < 1e-8) newDir = reflect(rd, n);
				else beta *= s.albedo;
			}
			ro = s.pos + newDir * RAY_EPS;
			rd = normalize(newDir);
			specularPath = true;
			bounce++;
			continue;
		}

		vec3 shadeOrigin = s.pos + s.ng * RAY_EPS;

		{
			vec3 L;
			float pdfL;
			vec3 Le = envSampleDir(L, pdfL);
			if (pdfL > 1e-8 && dot(L, s.ns) > 0.0 && dot(L, s.ng) > 0.0 && dot(Le, Le) > 0.0) {
				float pdfB;
				vec3 f = bsdfEval(s.ns, V, L, s.albedo, s.rough, s.metal, pdfB);
				if (dot(f, f) > 0.0 && !occluded(shadeOrigin, L, TFAR, false)) {
					radiance += beta * f * Le * powerHeuristic(pdfL, pdfB) / pdfL;
				}
			}
		}

		if (uSunEnable == 1) {
			float pdfL;
			vec3 L = sunSampleDir(pdfL);
			if (pdfL > 0.0 && dot(L, s.ns) > 0.0 && dot(L, s.ng) > 0.0) {
				float pdfB;
				vec3 f = bsdfEval(s.ns, V, L, s.albedo, s.rough, s.metal, pdfB);
				if (dot(f, f) > 0.0 && !occluded(shadeOrigin, L, TFAR, false)) {
					radiance += beta * f * uSunRadiance * powerHeuristic(pdfL, pdfB) / pdfL;
				}
			}
		}

		if (uLightCount > 0) {
			LightSample ls = sampleTriLight(s.pos);
			if (ls.pdf > 1e-8 && dot(ls.dir, s.ns) > 0.0 && dot(ls.dir, s.ng) > 0.0 && dot(ls.radiance, ls.radiance) > 0.0) {
				float pdfB;
				vec3 f = bsdfEval(s.ns, V, ls.dir, s.albedo, s.rough, s.metal, pdfB);
				if (dot(f, f) > 0.0 && !occluded(shadeOrigin, ls.dir, ls.dist - RAY_EPS * 2.0, false)) {
					radiance += beta * f * ls.radiance * powerHeuristic(ls.pdf, pdfB) / ls.pdf;
				}
			}
		}

		vec3 L, weight;
		float pdfB;
		if (!bsdfSample(s.ns, V, s.albedo, s.rough, s.metal, L, weight, pdfB)) break;
		if (dot(L, s.ng) <= 0.0) break;

		beta *= weight;
		lastPdf = pdfB;
		specularPath = false;
		prevPos = s.pos;
		ro = shadeOrigin;
		rd = L;
		bounce++;

		if (bounce > 2) {
			float q = clamp(max(beta.r, max(beta.g, beta.b)), 0.02, 0.95);
			if (rnd() > q) break;
			beta /= q;
		}
		if (dot(beta, beta) < 1e-12) break;
	}

	if (uClamp > 0.0) {
		float m = max(radiance.r, max(radiance.g, radiance.b));
		if (m > uClamp) radiance *= uClamp / m;
	}
	if (any(isnan(radiance)) || any(isinf(radiance))) radiance = vec3(0.0);
	return radiance;
}

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	g_rng = uint(px.x) * 1973u + uint(px.y) * 9277u + uint(uSeed) * 26699u;
	g_rng = g_rng | 1u;
	pcgNext();
	pcgNext();

	vec2 jitter = rnd2();
	vec2 ndc = ((gl_FragCoord.xy - 0.5 + jitter) / uResolution) * 2.0 - 1.0;

	vec3 ro, rd;
	if (uOrtho == 1) {
		ro = uCamPos + uCamRight * (ndc.x * uOrthoHalfHeight * uAspect) + uCamUp * (ndc.y * uOrthoHalfHeight);
		rd = normalize(uCamForward);
	} else {
		rd = normalize(uCamForward + uCamRight * (ndc.x * uTanHalfFov * uAspect) + uCamUp * (ndc.y * uTanHalfFov));
		ro = uCamPos;
		if (uAperture > 0.0 && uFocusDist > 0.0) {
			vec3 focal = ro + rd * (uFocusDist / max(dot(rd, normalize(uCamForward)), 1e-4));
			float ang = 2.0 * PI * rnd();
			float rad = uAperture * sqrt(rnd());
			ro += uCamRight * (cos(ang) * rad) + uCamUp * (sin(ang) * rad);
			rd = normalize(focal - ro);
		}
	}

	float alpha, depth;
	vec3 alb, nrm;
	vec3 c = tracePath(ro, rd, alpha, alb, nrm, depth);
	vec3 demod = c / max(alb, vec3(0.02));
	float l = dot(demod, vec3(0.2126, 0.7152, 0.0722));

	vec4 prev = vec4(0.0);
	vec4 prevA = vec4(0.0);
	vec4 prevN = vec4(0.0);
	vec4 prevM = vec4(0.0);
	if (uReset == 0) {
		prev = texelFetch(uAccum, px, 0);
		prevA = texelFetch(uAccumAlb, px, 0);
		prevN = texelFetch(uAccumNrm, px, 0);
		prevM = texelFetch(uAccumMom, px, 0);
	}
	outColor = prev + vec4(c, alpha);
	outAlbedo = prevA + vec4(alb, 1.0);
	outNormal = prevN + vec4(nrm, 1.0);
	outMoment = prevM + vec4(l, l * l, depth, 1.0);
}
`;

	const FS_DENOISE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uColorIn;
uniform sampler2D uAlbedoTex;
uniform sampler2D uNormalTex;
uniform sampler2D uMomentTex;
uniform sampler2D uVarianceIn;
uniform int   uFirst;
uniform float uInvSpp;
uniform int   uStepSize;
uniform float uPhiColorBase;
uniform float uPhiNormal;
uniform float uPhiDepth;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out float outVariance;

vec3 loadColor(ivec2 p, ivec2 size) {
	p = clamp(p, ivec2(0), size - 1);
	if (uFirst == 1) {
		vec3 c = texelFetch(uColorIn, p, 0).rgb * uInvSpp;
		vec3 a = max(texelFetch(uAlbedoTex, p, 0).rgb * uInvSpp, vec3(0.02));
		return c / a;
	}
	return texelFetch(uColorIn, p, 0).rgb;
}

float loadVariance(ivec2 p, ivec2 size) {
	p = clamp(p, ivec2(0), size - 1);
	if (uFirst == 1) {
		vec4 m = texelFetch(uMomentTex, p, 0) * uInvSpp;
		float perSample = max(m.y - m.x * m.x, 0.0);
		return perSample * uInvSpp;
	}
	return texelFetch(uVarianceIn, p, 0).r;
}

float loadDepth(ivec2 p, ivec2 size) {
	p = clamp(p, ivec2(0), size - 1);
	vec4 m = texelFetch(uMomentTex, p, 0);
	return m.w > 0.0 ? m.z / m.w : 1.0e6;
}

float kern(int d) {
	int i = d < 0 ? -d : d;
	if (i == 2) return 0.0625;
	if (i == 1) return 0.25;
	return 0.375;
}

void main() {
	ivec2 size = textureSize(uColorIn, 0);
	ivec2 px = ivec2(gl_FragCoord.xy);

	vec3 cp = loadColor(px, size);
	float varP = loadVariance(px, size);
	float depthP = loadDepth(px, size);
	vec3 np = texelFetch(uNormalTex, px, 0).xyz;
	float nl = length(np);
	np = nl > 1e-6 ? np / nl : vec3(0.0, 1.0, 0.0);

	float phiColor = uPhiColorBase * sqrt(max(varP, 0.0)) + 1e-4;

	vec3 sum = vec3(0.0);
	float wsum = 0.0;
	float varSum = 0.0;
	float varWsum = 0.0;
	for (int dy = -2; dy <= 2; dy++) {
		for (int dx = -2; dx <= 2; dx++) {
			ivec2 q = px + ivec2(dx, dy) * uStepSize;
			if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
			vec3 cq = loadColor(q, size);
			float varQ = loadVariance(q, size);
			float depthQ = loadDepth(q, size);
			vec3 nq = texelFetch(uNormalTex, q, 0).xyz;
			float ql = length(nq);
			nq = ql > 1e-6 ? nq / ql : vec3(0.0, 1.0, 0.0);

			vec3 dc = cp - cq;
			float wc = exp(-dot(dc, dc) / (phiColor * phiColor));
			float nd = max(0.0, 1.0 - dot(np, nq));
			float wn = exp(-nd * nd / max(uPhiNormal, 1e-5));
			float dd = abs(depthP - depthQ);
			float wd = (depthP > 1.0e5 || depthQ > 1.0e5) ? (dd < 1.0 ? 1.0 : 0.0)
				: exp(-dd * dd / max(uPhiDepth * depthP * depthP + 1e-6, 1e-6));
			float w = kern(dx) * kern(dy) * wc * wn * wd;
			sum += cq * w;
			wsum += w;
			varSum += varQ * w * w;
			varWsum += w;
		}
	}
	fragColor = vec4(wsum > 1e-8 ? sum / wsum : cp, 1.0);
	outVariance = varWsum > 1e-8 ? varSum / (varWsum * varWsum) : varP;
}
`;

	const FS_COMPOSITE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uAccumTex;
uniform sampler2D uDenoisedTex;
uniform sampler2D uAlbedoTex;
uniform float uInvSpp;
uniform int   uUseDenoise;
uniform float uExposure;

out vec4 fragColor;

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	vec4 acc = texelFetch(uAccumTex, px, 0);
	vec3 color;
	if (uUseDenoise == 1) {
		vec3 alb = max(texelFetch(uAlbedoTex, px, 0).rgb * uInvSpp, vec3(0.02));
		color = texelFetch(uDenoisedTex, px, 0).rgb * alb;
	} else {
		color = acc.rgb * uInvSpp;
	}
	float alpha = clamp(acc.a * uInvSpp, 0.0, 1.0);
	color = max(color, vec3(0.0)) * uExposure;
	fragColor = vec4(color, alpha);
}
`;

	const FS_BLOOM_BRIGHT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uHDR;
uniform float uThreshold;

out vec4 fragColor;

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	vec3 c = texelFetch(uHDR, px, 0).rgb;
	fragColor = vec4(max(c - vec3(uThreshold), 0.0), 1.0);
}
`;

	const FS_BLOOM_BLUR = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uRadius;

out vec4 fragColor;

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	ivec2 size = textureSize(uTex, 0);
	float sigma = max(uRadius, 0.5);
	float step = max(sigma / 4.0, 1.0);
	vec3 sum = vec3(0.0);
	float wsum = 0.0;
	for (int i = -8; i <= 8; i++) {
		float fi = float(i);
		float w = exp(-(fi * fi) / (2.0 * sigma * sigma));
		ivec2 q = px + ivec2(uDir * fi * step);
		q = clamp(q, ivec2(0), size - 1);
		sum += texelFetch(uTex, q, 0).rgb * w;
		wsum += w;
	}
	fragColor = vec4(wsum > 1e-6 ? sum / wsum : vec3(0.0), 1.0);
}
`;

	const FS_TONEMAP = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uHDR;
uniform sampler2D uBloomTex;
uniform int   uUseBloom;
uniform float uBloomIntensity;
uniform float uContrast;
uniform float uSaturation;
uniform int   uToneMap;
uniform int   uVignetteEnable;
uniform float uVignetteStrength;
uniform vec2  uResolution;

out vec4 fragColor;

vec3 tmReinhard(vec3 c) { return c / (1.0 + c); }

vec3 tmACES(vec3 x) {
	const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
	return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 uncharted2(vec3 x) {
	const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30;
	return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}
vec3 tmFilmic(vec3 c) {
	vec3 w = uncharted2(vec3(11.2));
	return clamp(uncharted2(c * 2.0) / w, 0.0, 1.0);
}

vec3 tmAgX(vec3 c) {
	c = max(c, vec3(0.0));
	const mat3 inSet = mat3(
		0.842479062253094, 0.0423282422610123, 0.0423756549057051,
		0.0784335999999992, 0.878468636469772, 0.0784336000000000,
		0.0792237451477643, 0.0791661274605434, 0.879142973793104);
	const mat3 outSet = mat3(
		1.19687900512017, -0.0528968517574562, -0.0529716355144438,
		-0.0980208811401368, 1.15190312990417, -0.0980434501171241,
		-0.0990297440797205, -0.0989611768448433, 1.15107367264116);
	c = inSet * c;
	c = clamp((log2(max(c, vec3(1e-10))) + 12.47393) / (12.47393 + 4.026069), 0.0, 1.0);
	vec3 x = c;
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	c = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
	c = outSet * c;
	return clamp(c, 0.0, 1.0);
}

vec3 linearToSRGB(vec3 c) {
	c = clamp(c, 0.0, 1.0);
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	vec4 hdr = texelFetch(uHDR, px, 0);
	vec3 color = hdr.rgb;
	if (uUseBloom == 1) color += texelFetch(uBloomTex, px, 0).rgb * uBloomIntensity;

	if (uToneMap == 1) color = tmReinhard(color);
	else if (uToneMap == 2) color = tmACES(color);
	else if (uToneMap == 3) color = tmFilmic(color);
	else if (uToneMap == 4) color = tmAgX(color);
	else color = clamp(color, 0.0, 1.0);

	float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
	color = mix(vec3(l), color, uSaturation);
	color = clamp((color - 0.5) * uContrast + 0.5, 0.0, 1.0);

	if (uVignetteEnable == 1) {
		vec2 uv = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
		float d = clamp(dot(uv, uv) * 0.5, 0.0, 1.0);
		color *= clamp(1.0 - uVignetteStrength * d, 0.0, 1.0);
	}

	fragColor = vec4(linearToSRGB(color), hdr.a);
}
`;

	const FS_FINAL = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTex;
uniform int   uSharpenEnable;
uniform float uSharpenStrength;
uniform int   uGrainEnable;
uniform float uGrainStrength;
uniform float uGrainSeed;

out vec4 fragColor;

float hash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	vec4 c = texelFetch(uTex, px, 0);
	vec3 color = c.rgb;

	if (uSharpenEnable == 1) {
		vec3 n = texelFetch(uTex, px + ivec2(0, 1), 0).rgb
			+ texelFetch(uTex, px + ivec2(0, -1), 0).rgb
			+ texelFetch(uTex, px + ivec2(1, 0), 0).rgb
			+ texelFetch(uTex, px + ivec2(-1, 0), 0).rgb;
		vec3 lap = color * 4.0 - n;
		color = clamp(color + uSharpenStrength * lap, 0.0, 1.0);
	}

	if (uGrainEnable == 1) {
		float n = hash(gl_FragCoord.xy + uGrainSeed) - 0.5;
		color = clamp(color + n * uGrainStrength, 0.0, 1.0);
	}

	fragColor = vec4(color, c.a);
}
`;


	class PathTracer {
		constructor(canvas) {
			this.canvas = canvas;
			this.gl = null;
			this.width = 1;
			this.height = 1;
			this.spp = 0;
			this.scene = null;
			this.env = null;
			this.camera = { pos: [0, 20, 60], target: [0, 8, 0], fov: 45, ortho: false, orthoHalfHeight: 20 };
			this.textures = {};
			this.buffers = null;
			this.ping = 0;
			this.disposed = false;
		}

		init() {
			const gl = this.canvas.getContext('webgl2', {
				alpha: true,
				antialias: false,
				depth: false,
				stencil: false,
				premultipliedAlpha: false,
				preserveDrawingBuffer: true,
				powerPreference: 'high-performance',
			});
			if (!gl) throw new Error('无法创建 WebGL2 上下文，路径追踪需要支持 WebGL2 的显卡/驱动。');
			this.gl = gl;

			this.extFloat = gl.getExtension('EXT_color_buffer_float');
			if (!this.extFloat) throw new Error('缺少 EXT_color_buffer_float 扩展，无法进行浮点累积渲染。');
			gl.getExtension('OES_texture_float_linear');

			this.progPT = createProgram(gl, VS_FULLSCREEN, FS_PATHTRACE, 'pathtrace');
			this.progDN = createProgram(gl, VS_FULLSCREEN, FS_DENOISE, 'denoise');
			this.progCM = createProgram(gl, VS_FULLSCREEN, FS_COMPOSITE, 'composite');
			this.progBB = createProgram(gl, VS_FULLSCREEN, FS_BLOOM_BRIGHT, 'bloom_bright');
			this.progBL = createProgram(gl, VS_FULLSCREEN, FS_BLOOM_BLUR, 'bloom_blur');
			this.progTM = createProgram(gl, VS_FULLSCREEN, FS_TONEMAP, 'tonemap');
			this.progFN = createProgram(gl, VS_FULLSCREEN, FS_FINAL, 'final');

			this.vao = gl.createVertexArray();

			this.dummy2D = createAtlasTexture(gl, new Uint8Array([255, 255, 255, 255]), 1, 1);
			this.dummyF = createDataTexture(gl, new Float32Array(4), 1, 1);
			this.dummyR = createR32FTexture(gl, new Float32Array([0]), 1, 1);
			this.dummyEnv = createEnvTexture(gl, new Float32Array([0, 0, 0, 1]), 1, 1);

			gl.disable(gl.DEPTH_TEST);
			gl.disable(gl.BLEND);
			gl.disable(gl.CULL_FACE);
			return this;
		}

		buildScene(settings, overrides) {
			const gl = this.gl;
			const t0 = performance.now();

			this.disposeScene();

			const geo = collectGeometry();
			if (geo.triCount === 0) {
				this.scene = { triCount: 0, lightCount: 0, stats: { tris: 0, textures: 0, nodes: 0, ms: 0 } };
				return this.scene;
			}

			const mats = buildMaterials(gl, geo.texRefs, settings, overrides);
			const bvh = buildBVH(geo.positions, geo.triCount);

			const n = geo.triCount;
			const triPos = new Float32Array(n * TRI_POS_TEXELS * 4);
			const triAttr = new Float32Array(n * TRI_ATTR_TEXELS * 4);
			const lightList = [];

			for (let k = 0; k < n; k++) {
				const t = bvh.order[k];
				const tex = geo.texRefs[t];
				const slot = tex ? (mats.slotOfUuid.get(tex.uuid) || 0) : 0;
				const isLight = mats.slotList[slot] && mats.slotList[slot].emissive ? 1 : 0;
				if (isLight && lightList.length < 4096) lightList.push(k);

				const po = k * TRI_POS_TEXELS * 4;
				const so = t * 9;
				triPos[po + 0] = geo.positions[so + 0];
				triPos[po + 1] = geo.positions[so + 1];
				triPos[po + 2] = geo.positions[so + 2];
				triPos[po + 3] = slot;
				const side = mats.slotList[slot] ? mats.slotList[slot].side : 'double';
				let cull = side === 'front' ? 1 : (side === 'back' ? 2 : 0);
				if (cull !== 0 && geo.flips[t]) cull = 3 - cull;

				triPos[po + 4] = geo.positions[so + 3];
				triPos[po + 5] = geo.positions[so + 4];
				triPos[po + 6] = geo.positions[so + 5];
				triPos[po + 7] = cull;
				triPos[po + 8] = geo.positions[so + 6];
				triPos[po + 9] = geo.positions[so + 7];
				triPos[po + 10] = geo.positions[so + 8];

				const ao = k * TRI_ATTR_TEXELS * 4;
				const no = t * 9;
				const uo = t * 6;
				triAttr[ao + 0] = geo.normals[no + 0];
				triAttr[ao + 1] = geo.normals[no + 1];
				triAttr[ao + 2] = geo.normals[no + 2];
				triAttr[ao + 3] = geo.uvs[uo + 0];
				triAttr[ao + 4] = geo.normals[no + 3];
				triAttr[ao + 5] = geo.normals[no + 4];
				triAttr[ao + 6] = geo.normals[no + 5];
				triAttr[ao + 7] = geo.uvs[uo + 1];
				triAttr[ao + 8] = geo.normals[no + 6];
				triAttr[ao + 9] = geo.normals[no + 7];
				triAttr[ao + 10] = geo.normals[no + 8];
				triAttr[ao + 11] = geo.uvs[uo + 2];
				triAttr[ao + 12] = geo.uvs[uo + 3];
				triAttr[ao + 13] = geo.uvs[uo + 4];
				triAttr[ao + 14] = geo.uvs[uo + 5];
				triAttr[ao + 15] = isLight;
			}

			const texTriPos = createDataTexture(gl, triPos, n * TRI_POS_TEXELS);
			const texTriAttr = createDataTexture(gl, triAttr, n * TRI_ATTR_TEXELS);
			const texBVH = createDataTexture(gl, bvh.nodes.subarray(0, bvh.nodeCount * 8), bvh.nodeCount * BVH_TEXELS);
			const texMat = createDataTexture(gl, mats.matData, mats.matCount * MAT_TEXELS);

			let texLights = null, lightW = 1;
			if (lightList.length > 0) {
				lightW = Math.min(lightList.length, 1024);
				const lh = Math.ceil(lightList.length / lightW);
				const arr = new Float32Array(lightW * lh);
				for (let i = 0; i < lightList.length; i++) arr[i] = lightList[i];
				texLights = createR32FTexture(gl, arr, lightW, lh);
			}

			this.scene = {
				triCount: n,
				lightCount: lightList.length,
				lightW: lightW,
				texTriPos: texTriPos,
				texTriAttr: texTriAttr,
				texBVH: texBVH,
				texMat: texMat,
				texLights: texLights,
				atlasColor: mats.atlasColor,
				atlasMER: mats.atlasMER,
				atlasNormal: mats.atlasNormal,
				bounds: computeBounds(geo.positions, n),
				stats: {
					tris: n,
					textures: mats.matCount - 1,
					nodes: bvh.nodeCount,
					atlas: mats.atlasSize,
					lights: lightList.length,
					ms: Math.round(performance.now() - t0),
				},
			};
			this.spp = 0;
			return this.scene;
		}

		disposeScene() {
			const gl = this.gl;
			const s = this.scene;
			if (!s || !gl) { this.scene = null; return; }
			[s.texTriPos, s.texTriAttr, s.texBVH, s.texMat].forEach(t => { if (t && t.texture) gl.deleteTexture(t.texture); });
			[s.texLights, s.atlasColor, s.atlasMER, s.atlasNormal].forEach(t => { if (t) gl.deleteTexture(t); });
			this.scene = null;
		}

		setEnvironment(settings, customImage) {
			const gl = this.gl;
			if (this.env) {
				if (this.env.tex) gl.deleteTexture(this.env.tex);
				if (this.env.cond) gl.deleteTexture(this.env.cond);
				if (this.env.marg) gl.deleteTexture(this.env.marg);
			}
			let pixels, w = ENV_W, h = ENV_H;
			if (settings.env_mode === 'image' && customImage) {
				pixels = resampleEquirect(customImage, w, h);
			} else {
				pixels = generateSkyPixels(settings);
			}
			const dist = buildEnvDistribution(pixels, w, h);
			this.env = {
				tex: createEnvTexture(gl, pixels, w, h),
				cond: createR32FTexture(gl, dist.cond, dist.width + 1, dist.height),
				marg: createR32FTexture(gl, dist.marg, dist.height + 1, 1),
				distW: dist.width,
				distH: dist.height,
			};
			this.spp = 0;
		}

		resize(w, h) {
			const gl = this.gl;
			w = Math.max(8, Math.round(w));
			h = Math.max(8, Math.round(h));
			if (this.width === w && this.height === h && this.buffers) return;
			this.width = w;
			this.height = h;
			this.canvas.width = w;
			this.canvas.height = h;
			this.disposeBuffers();

			const mk = () => ({
				color: createRenderTexture(gl, w, h, gl.RGBA32F),
				albedo: createRenderTexture(gl, w, h, gl.RGBA16F),
				normal: createRenderTexture(gl, w, h, gl.RGBA16F),
				moment: createRenderTexture(gl, w, h, gl.RGBA32F),
			});
			const a = mk(), b = mk();
			this.buffers = {
				a: a, b: b,
				fboA: createFBO(gl, [a.color, a.albedo, a.normal, a.moment]),
				fboB: createFBO(gl, [b.color, b.albedo, b.normal, b.moment]),
				d0: createRenderTexture(gl, w, h, gl.RGBA16F),
				d1: createRenderTexture(gl, w, h, gl.RGBA16F),
				v0: createRenderTexture(gl, w, h, gl.R32F),
				v1: createRenderTexture(gl, w, h, gl.R32F),
				hdr: createRenderTexture(gl, w, h, gl.RGBA16F),
				bloomA: createRenderTexture(gl, w, h, gl.RGBA16F),
				bloomB: createRenderTexture(gl, w, h, gl.RGBA16F),
				tonemapOut: createRenderTexture(gl, w, h, gl.RGBA16F),
			};
			this.buffers.fboD0 = createFBO(gl, [this.buffers.d0, this.buffers.v0]);
			this.buffers.fboD1 = createFBO(gl, [this.buffers.d1, this.buffers.v1]);
			this.buffers.fboHDR = createFBO(gl, [this.buffers.hdr]);
			this.buffers.fboBloomA = createFBO(gl, [this.buffers.bloomA]);
			this.buffers.fboBloomB = createFBO(gl, [this.buffers.bloomB]);
			this.buffers.fboTonemap = createFBO(gl, [this.buffers.tonemapOut]);
			this.ping = 0;
			this.reset();
		}

		disposeBuffers() {
			const gl = this.gl;
			const b = this.buffers;
			if (!b || !gl) return;
			[b.a, b.b].forEach(set => {
				gl.deleteTexture(set.color);
				gl.deleteTexture(set.albedo);
				gl.deleteTexture(set.normal);
				gl.deleteTexture(set.moment);
			});
			gl.deleteTexture(b.d0);
			gl.deleteTexture(b.d1);
			gl.deleteTexture(b.hdr);
			gl.deleteTexture(b.bloomA);
			gl.deleteTexture(b.bloomB);
			gl.deleteTexture(b.tonemapOut);
			gl.deleteFramebuffer(b.fboHDR);
			gl.deleteFramebuffer(b.fboBloomA);
			gl.deleteFramebuffer(b.fboBloomB);
			gl.deleteFramebuffer(b.fboTonemap);
			gl.deleteTexture(b.v0);
			gl.deleteTexture(b.v1);
			gl.deleteFramebuffer(b.fboA);
			gl.deleteFramebuffer(b.fboB);
			gl.deleteFramebuffer(b.fboD0);
			gl.deleteFramebuffer(b.fboD1);
			this.buffers = null;
		}

		reset() {
			const gl = this.gl;
			this.spp = 0;
			if (!this.buffers) return;
			gl.clearColor(0, 0, 0, 0);
			[this.buffers.fboA, this.buffers.fboB].forEach(fbo => {
				gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
				gl.clear(gl.COLOR_BUFFER_BIT);
			});
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		}

		setCamera(cam) {
			this.camera = cam;
			this.reset();
		}

		setCameraOnly(cam) {
			this.camera = cam;
		}

		bindTex(unit, tex, name, prog) {
			const gl = this.gl;
			gl.activeTexture(gl.TEXTURE0 + unit);
			gl.bindTexture(gl.TEXTURE_2D, tex);
			const loc = prog.uniforms[name];
			if (loc) gl.uniform1i(loc, unit);
		}

		renderPass(settings) {
			const gl = this.gl;
			if (!this.buffers || !this.scene || !this.env) return;

			const src = this.ping === 0 ? this.buffers.b : this.buffers.a;
			const dstFBO = this.ping === 0 ? this.buffers.fboA : this.buffers.fboB;

			gl.bindFramebuffer(gl.FRAMEBUFFER, dstFBO);
			gl.viewport(0, 0, this.width, this.height);
			gl.bindVertexArray(this.vao);

			const p = this.progPT;
			const u = p.uniforms;
			gl.useProgram(p.program);

			const s = this.scene;
			this.bindTex(0, s.texTriPos ? s.texTriPos.texture : this.dummyF.texture, 'uTriPos', p);
			this.bindTex(1, s.texTriAttr ? s.texTriAttr.texture : this.dummyF.texture, 'uTriAttr', p);
			this.bindTex(2, s.texBVH ? s.texBVH.texture : this.dummyF.texture, 'uBVH', p);
			this.bindTex(3, s.texMat ? s.texMat.texture : this.dummyF.texture, 'uMat', p);
			this.bindTex(4, s.atlasColor || this.dummy2D, 'uAtlasC', p);
			this.bindTex(5, s.atlasMER || this.dummy2D, 'uAtlasM', p);
			this.bindTex(6, s.atlasNormal || this.dummy2D, 'uAtlasN', p);
			this.bindTex(7, s.texLights || this.dummyR, 'uLightTex', p);
			this.bindTex(8, this.env.tex, 'uEnv', p);
			this.bindTex(9, this.env.cond, 'uEnvCond', p);
			this.bindTex(10, this.env.marg, 'uEnvMarg', p);
			this.bindTex(11, src.color, 'uAccum', p);
			this.bindTex(12, src.albedo, 'uAccumAlb', p);
			this.bindTex(13, src.normal, 'uAccumNrm', p);
			this.bindTex(14, src.moment, 'uAccumMom', p);

			gl.uniform2f(u.uResolution, this.width, this.height);
			gl.uniform1i(u.uSeed, (this.spp * 9781 + 1) | 0);
			gl.uniform1i(u.uMaxBounce, settings.max_bounce | 0);
			gl.uniform1f(u.uClamp, settings.clamp_value);
			gl.uniform1i(u.uFilterLinear, settings.filter_linear ? 1 : 0);
			gl.uniform1i(u.uReset, this.spp === 0 ? 1 : 0);

			gl.uniform1i(u.uTriPosW, s.texTriPos ? s.texTriPos.width : 1);
			gl.uniform1i(u.uTriAttrW, s.texTriAttr ? s.texTriAttr.width : 1);
			gl.uniform1i(u.uBVHW, s.texBVH ? s.texBVH.width : 1);
			gl.uniform1i(u.uMatW, s.texMat ? s.texMat.width : 1);
			gl.uniform1i(u.uLightW, s.lightW || 1);
			gl.uniform1i(u.uTriCount, s.triCount);
			gl.uniform1i(u.uLightCount, s.lightCount);

			const cam = this.camera;
			const fwd = vNorm(vSub(cam.target, cam.pos));
			let right = vCross(fwd, [0, 1, 0]);
			if (vDot(right, right) < 1e-8) right = vCross(fwd, [0, 0, 1]);
			right = vNorm(right);
			const up = vNorm(vCross(right, fwd));
			gl.uniform3f(u.uCamPos, cam.pos[0], cam.pos[1], cam.pos[2]);
			gl.uniform3f(u.uCamRight, right[0], right[1], right[2]);
			gl.uniform3f(u.uCamUp, up[0], up[1], up[2]);
			gl.uniform3f(u.uCamForward, fwd[0], fwd[1], fwd[2]);
			gl.uniform1f(u.uTanHalfFov, Math.tan(cam.fov * Math.PI / 360));
			gl.uniform1f(u.uAspect, this.width / this.height);
			gl.uniform1i(u.uOrtho, cam.ortho ? 1 : 0);
			gl.uniform1f(u.uOrthoHalfHeight, cam.orthoHalfHeight || 20);

			let focus = settings.focus_distance;
			if (settings.auto_focus || !focus) {
				focus = Math.hypot(cam.target[0] - cam.pos[0], cam.target[1] - cam.pos[1], cam.target[2] - cam.pos[2]);
			}
			gl.uniform1f(u.uAperture, settings.aperture);
			gl.uniform1f(u.uFocusDist, focus);

			gl.uniform2i(u.uEnvDist, this.env.distW, this.env.distH);
			gl.uniform1f(u.uEnvIntensity, settings.env_intensity);
			gl.uniform1f(u.uEnvRotation, settings.env_rotation * Math.PI / 180);
			gl.uniform1i(u.uBgMode, settings.bg_mode === 'color' ? 1 : (settings.bg_mode === 'transparent' ? 2 : 0));
			const bg = hexToLinear(settings.bg_color);
			gl.uniform3f(u.uBgColor, bg[0], bg[1], bg[2]);

			const sunOn = settings.sun_enable && settings.sun_intensity > 0;
			gl.uniform1i(u.uSunEnable, sunOn ? 1 : 0);
			if (sunOn) {
				const dir = sunDirection(settings);
				const radius = Math.max(settings.sun_angle, 0.25) * Math.PI / 360;
				const cosR = Math.cos(radius);
				const solid = Math.max(2 * Math.PI * (1 - cosR), 1e-7);
				const col = hexToLinear(settings.sun_color);
				const scale = settings.sun_intensity / solid;
				gl.uniform3f(u.uSunDir, dir[0], dir[1], dir[2]);
				gl.uniform1f(u.uSunCosRadius, cosR);
				gl.uniform1f(u.uSunSolidAngle, solid);
				gl.uniform3f(u.uSunRadiance, col[0] * scale, col[1] * scale, col[2] * scale);
			} else {
				gl.uniform3f(u.uSunDir, 0, 1, 0);
				gl.uniform1f(u.uSunCosRadius, 2);
				gl.uniform1f(u.uSunSolidAngle, 1);
				gl.uniform3f(u.uSunRadiance, 0, 0, 0);
			}

			gl.uniform1i(u.uGroundOn, settings.ground_on ? 1 : 0);
			gl.uniform1i(u.uGroundCatcher, settings.ground_catcher ? 1 : 0);
			gl.uniform1f(u.uGroundY, settings.ground_y);
			gl.uniform1f(u.uGroundRough, clamp(settings.ground_rough, 0.02, 1));
			gl.uniform1f(u.uGroundMetal, clamp(settings.ground_metal, 0, 1));
			gl.uniform1f(u.uGroundRadius, settings.ground_radius);
			const gc = hexToLinear(settings.ground_color);
			gl.uniform3f(u.uGroundColor, gc[0], gc[1], gc[2]);

			gl.drawArrays(gl.TRIANGLES, 0, 3);

			this.ping = 1 - this.ping;
			this.spp++;
		}

		currentSet() {
			return this.ping === 0 ? this.buffers.b : this.buffers.a;
		}

		present(settings) {
			const gl = this.gl;
			if (!this.buffers || this.spp === 0) return;
			const cur = this.currentSet();
			const invSpp = 1 / this.spp;
			gl.bindVertexArray(this.vao);

			let denoised = null;
			const useDenoise = settings.denoise && this.spp < 4096 && settings.denoise_strength > 0;

			if (useDenoise) {
				const p = this.progDN;
				gl.useProgram(p.program);
				const phiColorBase = 3.2 * settings.denoise_strength;
				const steps = [1, 2, 4, 8];
				let inputTex = cur.color;
				let varTex = null;
				let first = 1;
				for (let i = 0; i < steps.length; i++) {
					const targetFBO = (i % 2 === 0) ? this.buffers.fboD0 : this.buffers.fboD1;
					const targetTex = (i % 2 === 0) ? this.buffers.d0 : this.buffers.d1;
					const targetVar = (i % 2 === 0) ? this.buffers.v0 : this.buffers.v1;
					gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
					gl.viewport(0, 0, this.width, this.height);
					this.bindTex(0, inputTex, 'uColorIn', p);
					this.bindTex(1, cur.albedo, 'uAlbedoTex', p);
					this.bindTex(2, cur.normal, 'uNormalTex', p);
					this.bindTex(3, cur.moment, 'uMomentTex', p);
					this.bindTex(4, varTex || cur.moment, 'uVarianceIn', p);
					gl.uniform1i(p.uniforms.uFirst, first);
					gl.uniform1f(p.uniforms.uInvSpp, invSpp);
					gl.uniform1i(p.uniforms.uStepSize, steps[i]);
					gl.uniform1f(p.uniforms.uPhiColorBase, phiColorBase);
					gl.uniform1f(p.uniforms.uPhiNormal, 0.08);
					gl.uniform1f(p.uniforms.uPhiDepth, 0.01);
					gl.drawArrays(gl.TRIANGLES, 0, 3);
					inputTex = targetTex;
					varTex = targetVar;
					denoised = targetTex;
					first = 0;
				}
			}

			const buf = this.buffers;

			gl.bindFramebuffer(gl.FRAMEBUFFER, buf.fboHDR);
			gl.viewport(0, 0, this.width, this.height);
			{
				const p = this.progCM;
				gl.useProgram(p.program);
				this.bindTex(0, cur.color, 'uAccumTex', p);
				this.bindTex(1, denoised || cur.color, 'uDenoisedTex', p);
				this.bindTex(2, cur.albedo, 'uAlbedoTex', p);
				gl.uniform1f(p.uniforms.uInvSpp, invSpp);
				gl.uniform1i(p.uniforms.uUseDenoise, useDenoise && denoised ? 1 : 0);
				gl.uniform1f(p.uniforms.uExposure, settings.exposure);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}

			const useBloom = !!settings.bloom_enable;
			if (useBloom) {
				{
					const p = this.progBB;
					gl.bindFramebuffer(gl.FRAMEBUFFER, buf.fboBloomA);
					gl.useProgram(p.program);
					this.bindTex(0, buf.hdr, 'uHDR', p);
					gl.uniform1f(p.uniforms.uThreshold, settings.bloom_threshold);
					gl.drawArrays(gl.TRIANGLES, 0, 3);
				}
				const radius = Math.max(settings.bloom_radius, 0.1) * (this.width / 1280);
				{
					const p = this.progBL;
					gl.useProgram(p.program);
					gl.uniform1f(p.uniforms.uRadius, radius);
					gl.bindFramebuffer(gl.FRAMEBUFFER, buf.fboBloomB);
					this.bindTex(0, buf.bloomA, 'uTex', p);
					gl.uniform2f(p.uniforms.uDir, 1, 0);
					gl.drawArrays(gl.TRIANGLES, 0, 3);
					gl.bindFramebuffer(gl.FRAMEBUFFER, buf.fboBloomA);
					this.bindTex(0, buf.bloomB, 'uTex', p);
					gl.uniform2f(p.uniforms.uDir, 0, 1);
					gl.drawArrays(gl.TRIANGLES, 0, 3);
				}
			}

			gl.bindFramebuffer(gl.FRAMEBUFFER, buf.fboTonemap);
			gl.viewport(0, 0, this.width, this.height);
			{
				const p = this.progTM;
				gl.useProgram(p.program);
				this.bindTex(0, buf.hdr, 'uHDR', p);
				this.bindTex(1, useBloom ? buf.bloomA : buf.hdr, 'uBloomTex', p);
				gl.uniform1i(p.uniforms.uUseBloom, useBloom ? 1 : 0);
				gl.uniform1f(p.uniforms.uBloomIntensity, settings.bloom_intensity);
				gl.uniform1f(p.uniforms.uContrast, settings.contrast);
				gl.uniform1f(p.uniforms.uSaturation, settings.saturation);
				const tmMap = { none: 0, reinhard: 1, aces: 2, filmic: 3, agx: 4 };
				gl.uniform1i(p.uniforms.uToneMap, tmMap[settings.tone_mapping] != null ? tmMap[settings.tone_mapping] : 2);
				gl.uniform1i(p.uniforms.uVignetteEnable, settings.vignette_enable ? 1 : 0);
				gl.uniform1f(p.uniforms.uVignetteStrength, settings.vignette_strength);
				gl.uniform2f(p.uniforms.uResolution, this.width, this.height);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}

			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.viewport(0, 0, this.width, this.height);
			{
				const p = this.progFN;
				gl.useProgram(p.program);
				this.bindTex(0, buf.tonemapOut, 'uTex', p);
				gl.uniform1i(p.uniforms.uSharpenEnable, settings.sharpen_enable ? 1 : 0);
				gl.uniform1f(p.uniforms.uSharpenStrength, settings.sharpen_strength);
				gl.uniform1i(p.uniforms.uGrainEnable, settings.grain_enable ? 1 : 0);
				gl.uniform1f(p.uniforms.uGrainStrength, settings.grain_strength);
				gl.uniform1f(p.uniforms.uGrainSeed, (this.spp * 37.13) % 1000.0);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}
			gl.bindVertexArray(null);
		}

		dispose() {
			if (this.disposed) return;
			this.disposed = true;
			const gl = this.gl;
			if (!gl) return;
			this.disposeScene();
			this.disposeBuffers();
			if (this.env) {
				gl.deleteTexture(this.env.tex);
				gl.deleteTexture(this.env.cond);
				gl.deleteTexture(this.env.marg);
				this.env = null;
			}
			[this.progPT, this.progDN, this.progCM, this.progBB, this.progBL, this.progTM, this.progFN].forEach(p => { if (p) gl.deleteProgram(p.program); });
			if (this.dummy2D) gl.deleteTexture(this.dummy2D);
			if (this.dummyF) gl.deleteTexture(this.dummyF.texture);
			if (this.dummyR) gl.deleteTexture(this.dummyR);
			if (this.dummyEnv) gl.deleteTexture(this.dummyEnv);
			if (this.vao) gl.deleteVertexArray(this.vao);
			const lose = gl.getExtension('WEBGL_lose_context');
			if (lose) lose.loseContext();
			this.gl = null;
		}
	}

	function computeBounds(positions, triCount) {
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < triCount * 9; i += 3) {
			for (let a = 0; a < 3; a++) {
				const v = positions[i + a];
				if (v < min[a]) min[a] = v;
				if (v > max[a]) max[a] = v;
			}
		}
		if (!isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 16 };
		const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
		const radius = Math.max(1e-3, 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
		return { min: min, max: max, center: center, radius: radius };
	}


	const CSS = `
#ptr_root { display: flex; height: 100%; min-height: 480px; gap: 0; }
#ptr_root * { box-sizing: border-box; }
#ptr_viewport {
	flex: 1 1 auto; position: relative; background: #101014;
	display: flex; align-items: center; justify-content: center; overflow: hidden;
	min-width: 240px;
}
#ptr_viewport canvas {
	max-width: 100%; max-height: 100%; width: auto; height: auto;
	image-rendering: auto; cursor: grab;
	background-image: linear-gradient(45deg, #2a2a30 25%, transparent 25%),
		linear-gradient(-45deg, #2a2a30 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, #2a2a30 75%),
		linear-gradient(-45deg, transparent 75%, #2a2a30 75%);
	background-size: 16px 16px;
	background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
}
#ptr_viewport canvas.dragging { cursor: grabbing; }
#ptr_overlay {
	position: absolute; left: 8px; top: 8px; pointer-events: none;
	font-size: 11px; color: #fff; text-shadow: 0 1px 3px #000;
	background: rgba(0,0,0,0.45); padding: 3px 7px; border-radius: 3px;
}
#ptr_sidebar {
	width: 306px; flex: 0 0 306px; overflow-y: auto; overflow-x: hidden;
	padding: 4px 8px 12px 8px; background: var(--color-ui);
	border-left: 1px solid var(--color-border);
}
.ptr_section > summary {
	cursor: pointer; padding: 5px 2px; font-weight: 600; list-style: none;
	border-bottom: 1px solid var(--color-border); user-select: none;
	color: var(--color-light);
}
.ptr_section > summary::-webkit-details-marker { display: none; }
.ptr_section > summary::before { content: '▸ '; opacity: 0.7; }
.ptr_section[open] > summary::before { content: '▾ '; }
.ptr_section { margin-bottom: 4px; }
.ptr_row {
	display: flex; align-items: center; gap: 6px; margin: 4px 0; min-height: 22px;
}
.ptr_row > label { flex: 0 0 104px; font-size: 12px; color: var(--color-text); }
.ptr_row > .ptr_ctrl { flex: 1 1 auto; display: flex; align-items: center; gap: 5px; min-width: 0; }
.ptr_row input[type=range] { flex: 1 1 auto; min-width: 40px; }
.ptr_row input[type=number] {
	width: 58px; flex: 0 0 58px; background: var(--color-back);
	color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px;
	padding: 1px 3px; font-size: 11px;
}
.ptr_row input[type=color] { width: 34px; height: 20px; padding: 0; border: 1px solid var(--color-border); background: none; }
.ptr_row select {
	flex: 1 1 auto; min-width: 0; background: var(--color-back); color: var(--color-text);
	border: 1px solid var(--color-border); border-radius: 3px; padding: 2px; font-size: 12px;
}
.ptr_note { font-size: 11px; color: var(--color-subtle_text); margin: 4px 2px; line-height: 1.4; }
#ptr_footer {
	display: flex; align-items: center; gap: 8px; padding: 6px 8px;
	border-top: 1px solid var(--color-border); background: var(--color-ui);
}
#ptr_progress { flex: 1 1 auto; height: 6px; background: var(--color-back); border-radius: 3px; overflow: hidden; }
#ptr_progress > div { height: 100%; width: 0%; background: var(--color-accent); transition: width .1s linear; }
#ptr_status { font-size: 11px; color: var(--color-subtle_text); white-space: nowrap; }
.ptr_btn {
	background: var(--color-button); color: var(--color-text); border: 1px solid var(--color-border);
	border-radius: 3px; padding: 3px 10px; cursor: pointer; font-size: 12px; white-space: nowrap;
}
.ptr_btn:hover { background: var(--color-selected); }
.ptr_btn.accent { background: var(--color-accent); color: var(--color-accent_text); }
.ptr_presets { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
.ptr_presets .ptr_btn { padding: 2px 7px; font-size: 11px; }
.ptr_dialog_root .dialog_content { padding: 0 !important; overflow: hidden !important; }
.ptr_dialog_root .dialog_handle { cursor: move; }
#ptr_matlist { max-height: 260px; overflow-y: auto; }
.ptr_mat {
	border: 1px solid var(--color-border); border-radius: 3px; margin: 4px 0; padding: 4px;
}
.ptr_mat > .ptr_mat_head { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 2px; }
.ptr_mat > .ptr_mat_head img { width: 20px; height: 20px; image-rendering: pixelated; background: #0006; }
`;

	function el(tag, attrs, children) {
		const node = document.createElement(tag);
		if (attrs) {
			for (const k in attrs) {
				if (k === 'style' && typeof attrs[k] === 'object') Object.assign(node.style, attrs[k]);
				else if (k.startsWith('on') && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
				else if (k === 'text') node.textContent = attrs[k];
				else node.setAttribute(k, attrs[k]);
			}
		}
		(children || []).forEach(c => { if (c) node.appendChild(c); });
		return node;
	}

	class OrbitCam {
		constructor() {
			this.target = [0, 12, 0];
			this.distance = 70;
			this.theta = Math.PI * 0.25;
			this.phi = Math.PI * 0.42;
			this.fov = 45;
			this.ortho = false;
		}
		position() {
			const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
			return [
				this.target[0] + this.distance * sp * Math.sin(this.theta),
				this.target[1] + this.distance * cp,
				this.target[2] + this.distance * sp * Math.cos(this.theta),
			];
		}
		state() {
			return {
				pos: this.position(),
				target: this.target.slice(),
				fov: this.fov,
				ortho: this.ortho,
				orthoHalfHeight: this.distance * Math.tan(this.fov * Math.PI / 360),
			};
		}
		orbit(dx, dy) {
			this.theta -= dx * 0.008;
			this.phi = clamp(this.phi - dy * 0.008, 0.02, Math.PI - 0.02);
		}
		pan(dx, dy, aspectScale) {
			const pos = this.position();
			const fwd = vNorm(vSub(this.target, pos));
			let right = vCross(fwd, [0, 1, 0]);
			if (vDot(right, right) < 1e-8) right = [1, 0, 0];
			right = vNorm(right);
			const up = vNorm(vCross(right, fwd));
			const scale = this.distance * Math.tan(this.fov * Math.PI / 360) * 2 * aspectScale;
			this.target = vAdd(this.target, vAdd(vScale(right, -dx * scale), vScale(up, dy * scale)));
		}
		zoom(delta) {
			this.distance = clamp(this.distance * Math.exp(delta * 0.0012), 0.5, 20000);
		}
		frameBounds(bounds) {
			if (!bounds) return;
			this.target = bounds.center.slice();
			this.distance = Math.max(bounds.radius * 2.6, 4);
		}
		syncFromPreview() {
			try {
				const prev = (typeof Preview !== 'undefined') ? Preview.selected : null;
				if (!prev || !prev.camera) return false;
				const c = prev.camera;
				c.updateMatrixWorld(true);
				const e = c.matrixWorld.elements;
				const pos = [e[12], e[13], e[14]];
				const tgt = prev.controls && prev.controls.target
					? [prev.controls.target.x, prev.controls.target.y, prev.controls.target.z]
					: [0, 0, 0];
				const d = vSub(pos, tgt);
				const dist = Math.hypot(d[0], d[1], d[2]);
				if (!(dist > 1e-4)) return false;
				this.target = tgt;
				this.distance = dist;
				this.phi = clamp(Math.acos(clamp(d[1] / dist, -1, 1)), 0.02, Math.PI - 0.02);
				this.theta = Math.atan2(d[0], d[2]);
				if (typeof c.fov === 'number') this.fov = c.fov;
				this.ortho = !!prev.isOrtho;
				return true;
			} catch (err) {
				console.warn('[PathTracer] 同步相机失败', err);
				return false;
			}
		}
	}


	const STORAGE_KEY = 'pathtracer_preview_settings';

	const CHANGE_KIND = {
		def_roughness: 'scene', def_metalness: 'scene', emissive_strength: 'scene',
		alpha_cutoff: 'scene', alpha_mode: 'scene', render_sides: 'scene',
		env_mode: 'env', sun_enable: 'env', sun_elevation: 'env', sun_azimuth: 'env',
		sun_intensity: 'env', sun_color: 'env', sky_zenith: 'env', sky_horizon: 'env',
		sky_ground: 'env', sky_haze: 'env', grad_top: 'env', grad_bottom: 'env', solid_color: 'env',
		tone_mapping: 'post', exposure: 'post', contrast: 'post', saturation: 'post',
		denoise: 'post', denoise_strength: 'post',
		bloom_enable: 'post', bloom_threshold: 'post', bloom_intensity: 'post', bloom_radius: 'post',
		vignette_enable: 'post', vignette_strength: 'post',
		sharpen_enable: 'post', sharpen_strength: 'post',
		grain_enable: 'post', grain_strength: 'post',
		res_mode: 'resize', res_width: 'resize', res_height: 'resize',
		max_samples: 'post', auto_follow: 'post', auto_sync: 'post', interactive_scale: 'post',
	};

	const SKY_PRESETS = {
		'正午': { env_mode: 'sky', sun_enable: true, sun_elevation: 66, sun_azimuth: 140, sun_intensity: 6, sun_angle: 1.2, sun_color: '#fff6e8', sky_zenith: '#3c78c8', sky_horizon: '#c6dcf2', sky_ground: '#5a5a5e', sky_haze: 0.3, env_intensity: 1 },
		'黄昏': { env_mode: 'sky', sun_enable: true, sun_elevation: 7, sun_azimuth: 250, sun_intensity: 5, sun_angle: 2.0, sun_color: '#ff9a4d', sky_zenith: '#2b3f7a', sky_horizon: '#ffb27a', sky_ground: '#3a3238', sky_haze: 0.75, env_intensity: 1.1 },
		'阴天': { env_mode: 'sky', sun_enable: false, sun_intensity: 0, sky_zenith: '#b9c3cc', sky_horizon: '#dde3e8', sky_ground: '#6a6a6e', sky_haze: 1, env_intensity: 1.6 },
		'夜晚': { env_mode: 'sky', sun_enable: true, sun_elevation: 42, sun_azimuth: 300, sun_intensity: 0.35, sun_angle: 3, sun_color: '#c8d8ff', sky_zenith: '#080d1c', sky_horizon: '#16203a', sky_ground: '#0a0a10', sky_haze: 0.2, env_intensity: 1 },
		'影棚': { env_mode: 'gradient', sun_enable: true, sun_elevation: 35, sun_azimuth: 45, sun_intensity: 4, sun_angle: 12, sun_color: '#ffffff', grad_top: '#cfcfcf', grad_bottom: '#131316', env_intensity: 1, bg_mode: 'color', bg_color: '#1b1b20' },
	};

	const PTR = {
		dialog: null,
		tracer: null,
		cam: new OrbitCam(),
		settings: Object.assign({}, DEFAULTS),
		overrides: {},
		customEnv: null,
		customEnvName: '',
		open: false,
		paused: false,
		raf: 0,
		passesPerFrame: 1,
		lastFrame: 0,
		interacting: false,
		interactTimer: 0,
		nodes: {},
		controls: [],
		rebuildTimer: 0,
		autoFollow: false,
		stale: false,
		lastPasses: 0,
		spsEma: 0,
	};

	function formatDuration(sec) {
		if (!isFinite(sec) || sec < 0) return '--';
		if (sec < 90) return sec.toFixed(0) + 's';
		if (sec < 3600) return Math.floor(sec / 60) + 'm' + Math.round(sec % 60) + 's';
		return Math.floor(sec / 3600) + 'h' + Math.round((sec % 3600) / 60) + 'm';
	}

	function loadSettings() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const data = JSON.parse(raw);
				for (const k in DEFAULTS) if (data[k] !== undefined) PTR.settings[k] = data[k];
				if (data.__overrides) PTR.overrides = data.__overrides;
			}
		} catch (err) { }
	}

	function saveSettings() {
		try {
			const data = Object.assign({}, PTR.settings);
			data.__overrides = PTR.overrides;
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		} catch (err) { }
	}

	function makeRow(label, ctrls) {
		return el('div', { class: 'ptr_row' }, [
			el('label', { text: label, title: label }),
			el('div', { class: 'ptr_ctrl' }, ctrls),
		]);
	}

	function register(key, setter) {
		PTR.controls.push({ key: key, set: setter });
	}

	function syncControls() {
		PTR.controls.forEach(c => {
			try { c.set(PTR.settings[c.key]); } catch (err) { }
		});
	}

	function rowSlider(label, key, min, max, step, digits) {
		const s = PTR.settings;
		const range = el('input', { type: 'range', min: min, max: max, step: step, value: s[key] });
		const num = el('input', { type: 'number', min: min, max: max, step: step, value: s[key] });
		const apply = (raw, src) => {
			let v = parseFloat(raw);
			if (isNaN(v)) return;
			v = clamp(v, min, max);
			s[key] = v;
			if (src !== 'r') range.value = v;
			if (src !== 'n') num.value = digits != null ? +v.toFixed(digits) : v;
			onSettingChanged(key);
		};
		range.addEventListener('input', () => apply(range.value, 'r'));
		num.addEventListener('change', () => apply(num.value, 'n'));
		register(key, v => { range.value = v; num.value = digits != null ? +Number(v).toFixed(digits) : v; });
		return makeRow(label, [range, num]);
	}

	function rowNumber(label, key, min, max, step) {
		const s = PTR.settings;
		const num = el('input', { type: 'number', min: min, max: max, step: step, value: s[key] });
		num.addEventListener('change', () => {
			let v = parseFloat(num.value);
			if (isNaN(v)) return;
			v = clamp(v, min, max);
			s[key] = v;
			num.value = v;
			onSettingChanged(key);
		});
		register(key, v => { num.value = v; });
		return makeRow(label, [num]);
	}

	function rowCheck(label, key) {
		const s = PTR.settings;
		const box = el('input', { type: 'checkbox' });
		box.checked = !!s[key];
		box.addEventListener('change', () => { s[key] = box.checked; onSettingChanged(key); });
		register(key, v => { box.checked = !!v; });
		return makeRow(label, [box]);
	}

	function rowColor(label, key) {
		const s = PTR.settings;
		const inp = el('input', { type: 'color', value: s[key] });
		inp.addEventListener('input', () => { s[key] = inp.value; onSettingChanged(key); });
		register(key, v => { inp.value = v; });
		return makeRow(label, [inp]);
	}

	function rowSelect(label, key, options) {
		const s = PTR.settings;
		const sel = el('select');
		for (const val in options) {
			const o = el('option', { value: val, text: options[val] });
			sel.appendChild(o);
		}
		sel.value = s[key];
		sel.addEventListener('change', () => { s[key] = sel.value; onSettingChanged(key); });
		register(key, v => { sel.value = v; });
		return makeRow(label, [sel]);
	}

	function section(title, open, children) {
		const det = el('details', { class: 'ptr_section' }, [el('summary', { text: title })].concat(children));
		if (open) det.setAttribute('open', '');
		return det;
	}

	function onSettingChanged(key) {
		saveSettings();
		const kind = CHANGE_KIND[key] || 'reset';
		const t = PTR.tracer;
		if (!t) return;
		if (kind === 'post') { t.present(PTR.settings); updateStatus(); return; }
		if (kind === 'resize') { applyResolution(); return; }
		if (kind === 'env') {
			try { t.setEnvironment(PTR.settings, PTR.customEnv); } catch (err) { showError(err); return; }
		}
		if (kind === 'scene') {
			clearTimeout(PTR.rebuildTimer);
			PTR.rebuildTimer = setTimeout(() => rebuildScene(), 220);
			return;
		}
		t.reset();
	}

	function showError(err) {
		console.error('[PathTracer]', err);
		if (PTR.nodes.overlay) PTR.nodes.overlay.textContent = '错误: ' + (err && err.message ? err.message : err);
		try { Blockbench.showQuickMessage('路径追踪出错: ' + (err && err.message ? err.message : err), 3000); } catch (e) { }
	}

	function rebuildScene() {
		const t = PTR.tracer;
		if (!t || !PTR.open) return;
		try {
			const scene = t.buildScene(PTR.settings, PTR.overrides);
			PTR.stale = false;
			buildMaterialList();
			updateStatus(scene);
			t.reset();
		} catch (err) {
			showError(err);
		}
	}

	function applyResolution() {
		const t = PTR.tracer;
		if (!t || !PTR.nodes.viewport) return;
		const rect = PTR.nodes.viewport.getBoundingClientRect();
		let w, h;
		if (PTR.settings.res_mode === 'custom') {
			w = PTR.settings.res_width;
			h = PTR.settings.res_height;
		} else {
			w = Math.max(64, Math.floor(rect.width));
			h = Math.max(64, Math.floor(rect.height));
		}
		const scale = PTR.interacting ? clamp(PTR.settings.interactive_scale, 0.2, 1) : 1;
		const nw = Math.round(w * scale), nh = Math.round(h * scale);
		if (nw !== t.width || nh !== t.height) {
			PTR.spsEma = 0;
			PTR.lastPasses = 0;
		}
		t.resize(nw, nh);
		if (PTR.settings.res_mode === 'custom') {
			PTR.nodes.canvas.style.width = '';
			PTR.nodes.canvas.style.height = '';
		} else {
			PTR.nodes.canvas.style.width = '100%';
			PTR.nodes.canvas.style.height = '100%';
		}
	}

	function setInteracting(on) {
		if (PTR.interacting === on) return;
		PTR.interacting = on;
		if (PTR.settings.interactive_scale < 1) applyResolution();
	}

	function updateStatus(scene) {
		const t = PTR.tracer;
		if (!t || !PTR.nodes.status) return;
		const s = scene || t.scene;
		const max = PTR.settings.max_samples;
		const pct = clamp(t.spp / Math.max(max, 1), 0, 1);
		PTR.nodes.bar.style.width = (pct * 100).toFixed(1) + '%';
		let line = t.spp + ' / ' + max + ' spp　' + t.width + '×' + t.height;
		if (PTR.spsEma > 0.001) {
			const msPerSpp = 1000 / PTR.spsEma;
			const mpix = t.width * t.height * PTR.spsEma / 1e6;
			line += '　' + (msPerSpp < 10 ? msPerSpp.toFixed(1) : msPerSpp.toFixed(0)) + ' ms/spp';
			line += '　' + mpix.toFixed(1) + ' Mpix/s';
			const left = max - t.spp;
			if (left > 0 && !PTR.paused) line += '　剩余 ~' + formatDuration(left / PTR.spsEma);
		}
		if (s && s.stats) {
			line += '　△' + s.stats.tris + '　BVH ' + s.stats.nodes;
			if (s.stats.lights) line += '　光源 ' + s.stats.lights;
		}
		if (PTR.paused) line = '[暂停] ' + line;
		if (PTR.stale) line += '　(模型已修改)';
		PTR.nodes.status.textContent = line;
		if (PTR.nodes.overlay) {
			PTR.nodes.overlay.textContent = t.spp >= max ? '渲染完成 · ' + t.spp + ' spp' : t.spp + ' spp';
		}
	}

	function loop() {
		if (!PTR.open) return;
		if (PTR.nodes.canvas && !PTR.nodes.canvas.isConnected) { closeRenderer(); return; }
		PTR.raf = requestAnimationFrame(loop);
		const t = PTR.tracer;
		if (!t || !t.scene || !t.env || PTR.paused) return;

		const now = performance.now();
		const dt = now - PTR.lastFrame;
		PTR.lastFrame = now;
		const targetMs = PTR.interacting ? 24 : 42;
		if (dt < targetMs * 0.75) PTR.passesPerFrame = Math.min(64, PTR.passesPerFrame + 1);
		else if (dt > targetMs * 1.35) PTR.passesPerFrame = Math.max(1, PTR.passesPerFrame - 1);

		if (PTR.lastPasses > 0 && dt > 0.5) {
			const inst = PTR.lastPasses * 1000 / dt;
			PTR.spsEma = PTR.spsEma > 0 ? (PTR.spsEma * 0.85 + inst * 0.15) : inst;
		}
		PTR.lastPasses = 0;

		if (PTR.cam.fov !== PTR.settings.fov || PTR.cam.ortho !== !!PTR.settings.ortho) {
			PTR.cam.fov = PTR.settings.fov;
			PTR.cam.ortho = !!PTR.settings.ortho;
			t.reset();
		}

		if (PTR.settings.auto_sync) {
			const before = PTR.cam.position().concat(PTR.cam.target);
			if (PTR.cam.syncFromPreview()) {
				const after = PTR.cam.position().concat(PTR.cam.target);
				for (let i = 0; i < 6; i++) {
					if (Math.abs(before[i] - after[i]) > 1e-4) { t.reset(); break; }
				}
			}
		}

		if (t.spp >= PTR.settings.max_samples) return;

		try {
			t.setCameraOnly(PTR.cam.state());
			const n = Math.min(PTR.passesPerFrame, PTR.settings.max_samples - t.spp);
			for (let i = 0; i < n; i++) t.renderPass(PTR.settings);
			t.present(PTR.settings);
			PTR.lastPasses = n;
		} catch (err) {
			showError(err);
			PTR.paused = true;
		}
		updateStatus();
	}

	function buildMaterialList() {
		const host = PTR.nodes.matlist;
		if (!host) return;
		host.innerHTML = '';
		const t = PTR.tracer;
		const all = (typeof Texture !== 'undefined' ? Texture.all : []) || [];
		const textures = all.filter(tex => {
			try {
				const g = tex.getGroup && tex.getGroup();
				if (g && g.is_material) return tex.pbr_channel === 'color';
			} catch (err) { }
			return true;
		});
		if (!textures.length) {
			host.appendChild(el('div', { class: 'ptr_note', text: '当前项目没有纹理。' }));
			return;
		}
		textures.forEach(tex => {
			const ov = PTR.overrides[tex.uuid] || (PTR.overrides[tex.uuid] = {});
			let hasMer = false;
			try {
				const g = tex.getGroup && tex.getGroup();
				if (g && g.is_material) hasMer = !!g.getTextures().find(x => x.pbr_channel === 'mer');
			} catch (err) { }
			const defEmis = (hasMer || tex.render_mode === 'emissive' || tex.render_mode === 'additive') ? 1 : 0;
			const box = el('div', { class: 'ptr_mat' });
			const head = el('div', { class: 'ptr_mat_head' });
			try {
				const img = el('img');
				img.src = tex.source || (tex.canvas ? tex.canvas.toDataURL() : '');
				head.appendChild(img);
			} catch (err) { }
			head.appendChild(el('span', { text: tex.name || '(未命名)' }));
			box.appendChild(head);

			const mk = (label, key, min, max, step, def) => {
				const range = el('input', { type: 'range', min: min, max: max, step: step, value: ov[key] != null ? ov[key] : def });
				const num = el('input', { type: 'number', min: min, max: max, step: step, value: ov[key] != null ? ov[key] : def });
				const apply = (raw, src) => {
					let v = parseFloat(raw);
					if (isNaN(v)) return;
					v = clamp(v, min, max);
					ov[key] = v;
					if (src !== 'r') range.value = v;
					if (src !== 'n') num.value = v;
					saveSettings();
					clearTimeout(PTR.rebuildTimer);
					PTR.rebuildTimer = setTimeout(() => rebuildScene(), 250);
				};
				range.addEventListener('input', () => apply(range.value, 'r'));
				num.addEventListener('change', () => apply(num.value, 'n'));
				box.appendChild(makeRow(label, [range, num]));
			};
			mk('粗糙度', 'roughness', 0, 1, 0.01, PTR.settings.def_roughness);
			mk('金属度', 'metalness', 0, 1, 0.01, PTR.settings.def_metalness);
			mk('自发光', 'emissive', 0, 20, 0.1, defEmis);
			mk('透射', 'transmission', 0, 1, 0.01, 0);
			mk('Alpha 阈值', 'alpha_cutoff', 0, 1, 0.01, PTR.settings.alpha_cutoff);

			const amodeSel = el('select');
			[['', '跟随全局'], ['cutout', '裁剪'], ['blend', '混合'], ['opaque', '忽略透明']].forEach(pair => {
				amodeSel.appendChild(el('option', { value: pair[0], text: pair[1] }));
			});
			amodeSel.value = ov.alpha_mode || '';
			amodeSel.addEventListener('change', () => {
				if (amodeSel.value) ov.alpha_mode = amodeSel.value;
				else delete ov.alpha_mode;
				saveSettings();
				clearTimeout(PTR.rebuildTimer);
				PTR.rebuildTimer = setTimeout(() => rebuildScene(), 120);
			});
			box.appendChild(makeRow('Alpha 模式', [amodeSel]));

			const reset = el('button', { class: 'ptr_btn', text: '重置此纹理' });
			reset.addEventListener('click', () => {
				delete PTR.overrides[tex.uuid];
				saveSettings();
				buildMaterialList();
				rebuildScene();
			});
			box.appendChild(reset);
			host.appendChild(box);
		});
	}

	function buildSidebar() {
		PTR.controls = [];
		const bar = el('div', { id: 'ptr_sidebar' });

		bar.appendChild(section('渲染', true, [
			rowSelect('分辨率', 'res_mode', { fit: '自适应窗口', custom: '自定义' }),
			rowNumber('宽度', 'res_width', 32, 8192, 1),
			rowNumber('高度', 'res_height', 32, 8192, 1),
			rowNumber('目标采样数', 'max_samples', 1, 100000, 1),
			rowSlider('最大反弹', 'max_bounce', 1, 16, 1, 0),
			rowSlider('亮度截断', 'clamp_value', 0, 100, 0.5, 1),
			rowSlider('交互降采样', 'interactive_scale', 0.2, 1, 0.05, 2),
			rowCheck('线性过滤纹理', 'filter_linear'),
			rowCheck('自动重载模型', 'auto_follow'),
			el('div', { class: 'ptr_note', text: '亮度截断可抑制萤火虫噪点，设为 0 表示关闭（更物理准确但收敛更慢）' }),
		]));

		const camBtns = el('div', { class: 'ptr_presets' });
		const btnSync = el('button', { class: 'ptr_btn', text: '同步主视图' });
		btnSync.addEventListener('click', () => {
			if (PTR.cam.syncFromPreview()) {
				PTR.settings.fov = PTR.cam.fov;
				PTR.settings.ortho = PTR.cam.ortho;
				syncControls();
				if (PTR.tracer) PTR.tracer.reset();
			}
		});
		const btnFrame = el('button', { class: 'ptr_btn', text: '框选模型' });
		btnFrame.addEventListener('click', () => {
			if (PTR.tracer && PTR.tracer.scene) PTR.cam.frameBounds(PTR.tracer.scene.bounds);
			if (PTR.tracer) PTR.tracer.reset();
		});
		camBtns.appendChild(btnSync);
		camBtns.appendChild(btnFrame);

		bar.appendChild(section('相机', true, [
			camBtns,
			rowCheck('正交投影', 'ortho'),
			rowSlider('FOV', 'fov', 5, 120, 1, 0),
			rowSlider('光圈', 'aperture', 0, 8, 0.05, 2),
			rowCheck('自动对焦', 'auto_focus'),
			rowNumber('对焦距离', 'focus_distance', 0, 10000, 0.5),
			rowCheck('自动跟随主视图', 'auto_sync'),
		]));

		const presets = el('div', { class: 'ptr_presets' });
		Object.keys(SKY_PRESETS).forEach(name => {
			const b = el('button', { class: 'ptr_btn', text: name });
			b.addEventListener('click', () => {
				Object.assign(PTR.settings, SKY_PRESETS[name]);
				syncControls();
				saveSettings();
				try {
					if (PTR.tracer) {
						PTR.tracer.setEnvironment(PTR.settings, PTR.customEnv);
						PTR.tracer.reset();
					}
				} catch (err) { showError(err); }
			});
			presets.appendChild(b);
		});

		const envFile = el('input', { type: 'file', accept: '.hdr,.png,.jpg,.jpeg,.webp', style: { display: 'none' } });
		envFile.addEventListener('change', () => {
			const f = envFile.files && envFile.files[0];
			if (f) loadEnvFile(f);
			envFile.value = '';
		});
		const envBtns = el('div', { class: 'ptr_presets' }, [envFile]);
		const btnLoad = el('button', { class: 'ptr_btn', text: '载入 HDR / 图片' });
		btnLoad.addEventListener('click', () => envFile.click());
		const btnClear = el('button', { class: 'ptr_btn', text: '清除' });
		btnClear.addEventListener('click', () => {
			PTR.customEnv = null;
			PTR.customEnvName = '';
			PTR.nodes.envName.textContent = '(未载入)';
			if (PTR.settings.env_mode === 'image') { PTR.settings.env_mode = 'sky'; syncControls(); }
			try { if (PTR.tracer) PTR.tracer.setEnvironment(PTR.settings, null); } catch (err) { showError(err); }
		});
		envBtns.appendChild(btnLoad);
		envBtns.appendChild(btnClear);
		PTR.nodes.envName = el('span', { class: 'ptr_note', text: '(未载入)' });

		bar.appendChild(section('环境光', true, [
			presets,
			rowSelect('环境类型', 'env_mode', { sky: '程序化天空', gradient: '渐变', solid: '纯色', image: 'HDR / 图片' }),
			envBtns,
			PTR.nodes.envName,
			rowSlider('环境强度', 'env_intensity', 0, 20, 0.05, 2),
			rowSlider('环境旋转', 'env_rotation', -180, 180, 1, 0),
			rowSelect('背景', 'bg_mode', { env: '显示环境', color: '纯色', transparent: '透明' }),
			rowColor('背景颜色', 'bg_color'),
			rowCheck('启用太阳', 'sun_enable'),
			rowSlider('太阳高度', 'sun_elevation', -10, 90, 0.5, 1),
			rowSlider('太阳方位', 'sun_azimuth', 0, 360, 1, 0),
			rowSlider('太阳角直径', 'sun_angle', 0.25, 45, 0.05, 2),
			rowSlider('太阳强度', 'sun_intensity', 0, 40, 0.1, 2),
			rowColor('太阳颜色', 'sun_color'),
			rowColor('天顶色', 'sky_zenith'),
			rowColor('地平线色', 'sky_horizon'),
			rowColor('地面色', 'sky_ground'),
			rowSlider('雾霾', 'sky_haze', 0, 1, 0.01, 2),
			rowColor('渐变-上', 'grad_top'),
			rowColor('渐变-下', 'grad_bottom'),
			rowColor('纯色环境', 'solid_color'),
		]));

		bar.appendChild(section('地面', false, [
			rowCheck('启用地面', 'ground_on'),
			rowCheck('阴影捕捉（透明）', 'ground_catcher'),
			rowNumber('地面高度', 'ground_y', -1000, 1000, 0.5),
			rowColor('颜色', 'ground_color'),
			rowSlider('粗糙度', 'ground_rough', 0.02, 1, 0.01, 2),
			rowSlider('金属度', 'ground_metal', 0, 1, 0.01, 2),
			rowNumber('半径（0=无限）', 'ground_radius', 0, 100000, 1),
			el('div', { class: 'ptr_note', text: '阴影捕捉模式下地面本身不着色，只在背景中输出阴影的 alpha，配合“背景=透明”可导出带投影的透明 PNG' }),
		]));

		PTR.nodes.matlist = el('div', { id: 'ptr_matlist' });
		bar.appendChild(section('材质', false, [
			rowSlider('默认粗糙度', 'def_roughness', 0, 1, 0.01, 2),
			rowSlider('默认金属度', 'def_metalness', 0, 1, 0.01, 2),
			rowSlider('自发光强度', 'emissive_strength', 0, 40, 0.1, 2),
			rowSelect('渲染面', 'render_sides', { auto: '跟随 Blockbench', double: '强制双面', front: '强制单面' }),
			el('div', { class: 'ptr_note', text: '跟随 Blockbench 时会按格式/纹理做背面剔除（Java 方块模型为单面），负尺寸方块因此只显示内部贴图，与视图一致。' }),
			rowSelect('Alpha 模式', 'alpha_mode', { cutout: '裁剪（Minecraft）', blend: '混合（半透明）', opaque: '忽略透明' }),
			rowSlider('默认 Alpha 阈值', 'alpha_cutoff', 0, 1, 0.01, 2),
			el('div', { class: 'ptr_note', text: '裁剪: alpha 低于阈值的像素完全不可见(树叶/栅栏)。混合: 按 alpha 随机穿透，可渲染染色玻璃等半透明材质。' }),
			el('div', { class: 'ptr_note', text: '带 MER 通道的材质组会自动使用金属/自发光/粗糙贴图；纹理“发光”渲染模式会被当作自发光光源。' }),
			PTR.nodes.matlist,
		]));

		bar.appendChild(section('后期', true, [
			rowSelect('色调映射', 'tone_mapping', { none: '无', reinhard: 'Reinhard', aces: 'ACES', filmic: 'Filmic', agx: 'AgX' }),
			rowSlider('曝光', 'exposure', 0.05, 8, 0.01, 2),
			rowSlider('对比度', 'contrast', 0.2, 3, 0.01, 2),
			rowSlider('饱和度', 'saturation', 0, 3, 0.01, 2),
			rowCheck('降噪', 'denoise'),
			rowSlider('降噪强度', 'denoise_strength', 0, 8, 0.05, 2),
		]));

		bar.appendChild(section('后处理效果', false, [
			rowCheck('泛光 Bloom', 'bloom_enable'),
			rowSlider('泛光阈值', 'bloom_threshold', 0, 10, 0.05, 2),
			rowSlider('泛光强度', 'bloom_intensity', 0, 5, 0.01, 2),
			rowSlider('泛光半径', 'bloom_radius', 0.2, 10, 0.1, 1),
			rowCheck('暗角 Vignette', 'vignette_enable'),
			rowSlider('暗角强度', 'vignette_strength', 0, 1.5, 0.01, 2),
			rowCheck('锐化 Sharpen', 'sharpen_enable'),
			rowSlider('锐化强度', 'sharpen_strength', 0, 2, 0.01, 2),
			rowCheck('胶片颗粒', 'grain_enable'),
			rowSlider('颗粒强度', 'grain_strength', 0, 0.3, 0.005, 3),
		]));

		return bar;
	}

	function loadEnvFile(file) {
		const name = file.name || '';
		const reader = new FileReader();
		reader.onerror = () => showError(new Error('读取文件失败'));
		if (/\.hdr$/i.test(name)) {
			reader.onload = () => {
				try {
					PTR.customEnv = parseHDR(reader.result);
					PTR.customEnvName = name;
					PTR.settings.env_mode = 'image';
					syncControls();
					PTR.nodes.envName.textContent = name + '  (' + PTR.customEnv.width + '×' + PTR.customEnv.height + ')';
					if (PTR.tracer) PTR.tracer.setEnvironment(PTR.settings, PTR.customEnv);
					saveSettings();
				} catch (err) { showError(err); }
			};
			reader.readAsArrayBuffer(file);
		} else {
			reader.onload = () => {
				const img = new Image();
				img.onload = () => {
					try {
						const c = document.createElement('canvas');
						const maxW = 4096;
						const sc = Math.min(1, maxW / img.naturalWidth);
						c.width = Math.max(2, Math.round(img.naturalWidth * sc));
						c.height = Math.max(2, Math.round(img.naturalHeight * sc));
						const ctx = c.getContext('2d');
						ctx.drawImage(img, 0, 0, c.width, c.height);
						const src = ctx.getImageData(0, 0, c.width, c.height).data;
						const data = new Float32Array(c.width * c.height * 4);
						for (let i = 0; i < c.width * c.height; i++) {
							data[i * 4] = srgbToLinear(src[i * 4] / 255);
							data[i * 4 + 1] = srgbToLinear(src[i * 4 + 1] / 255);
							data[i * 4 + 2] = srgbToLinear(src[i * 4 + 2] / 255);
							data[i * 4 + 3] = 1;
						}
						PTR.customEnv = { width: c.width, height: c.height, data: data };
						PTR.customEnvName = name;
						PTR.settings.env_mode = 'image';
						syncControls();
						PTR.nodes.envName.textContent = name + '  (' + c.width + '×' + c.height + ')';
						if (PTR.tracer) PTR.tracer.setEnvironment(PTR.settings, PTR.customEnv);
						saveSettings();
					} catch (err) { showError(err); }
				};
				img.onerror = () => showError(new Error('无法解码图片'));
				img.src = reader.result;
			};
			reader.readAsDataURL(file);
		}
	}

	function saveImage() {
		const t = PTR.tracer;
		if (!t || t.spp === 0) {
			Blockbench.showQuickMessage('还没有渲染结果', 1500);
			return;
		}
		try {
			t.present(PTR.settings);
			const dataUrl = t.canvas.toDataURL('image/png');
			if (typeof Screencam !== 'undefined' && Screencam.returnScreenshot) {
				Screencam.returnScreenshot(dataUrl);
			} else {
				Blockbench.export({
					type: 'PNG',
					extensions: ['png'],
					name: (Project && Project.name ? Project.name : 'render') + '_pathtraced',
					content: dataUrl,
					savetype: 'image',
				});
			}
		} catch (err) {
			showError(err);
		}
	}

	function attachViewportEvents(canvas) {
		let dragging = 0;
		let lastX = 0, lastY = 0;

		const endDrag = () => {
			dragging = 0;
			canvas.classList.remove('dragging');
			clearTimeout(PTR.interactTimer);
			PTR.interactTimer = setTimeout(() => setInteracting(false), 200);
		};

		canvas.addEventListener('pointerdown', e => {
			dragging = (e.button === 0 && !e.shiftKey && !e.ctrlKey) ? 1 : 2;
			lastX = e.clientX; lastY = e.clientY;
			canvas.setPointerCapture(e.pointerId);
			canvas.classList.add('dragging');
			clearTimeout(PTR.interactTimer);
			setInteracting(true);
			e.preventDefault();
		});
		canvas.addEventListener('pointermove', e => {
			if (!dragging) return;
			const dx = e.clientX - lastX;
			const dy = e.clientY - lastY;
			lastX = e.clientX; lastY = e.clientY;
			if (dragging === 1) PTR.cam.orbit(dx, dy);
			else PTR.cam.pan(dx / Math.max(canvas.clientWidth, 1), dy / Math.max(canvas.clientHeight, 1), 1);
			if (PTR.tracer) PTR.tracer.reset();
		});
		canvas.addEventListener('pointerup', e => { endDrag(); try { canvas.releasePointerCapture(e.pointerId); } catch (err) { } });
		canvas.addEventListener('pointercancel', endDrag);
		canvas.addEventListener('contextmenu', e => e.preventDefault());
		canvas.addEventListener('wheel', e => {
			e.preventDefault();
			PTR.cam.zoom(e.deltaY);
			clearTimeout(PTR.interactTimer);
			setInteracting(true);
			PTR.interactTimer = setTimeout(() => setInteracting(false), 250);
			if (PTR.tracer) PTR.tracer.reset();
		}, { passive: false });
	}

	function buildWindow() {
		const canvas = el('canvas', { id: 'ptr_canvas' });
		const overlay = el('div', { id: 'ptr_overlay', text: '准备中（若长时间无法加载请点击 重载模型 按钮）…' });
		const viewport = el('div', { id: 'ptr_viewport' }, [canvas, overlay]);
		const sidebar = buildSidebar();
		const root = el('div', { id: 'ptr_root' }, [viewport, sidebar]);

		const bar = el('div');
		const progress = el('div', { id: 'ptr_progress' }, [bar]);
		const status = el('div', { id: 'ptr_status', text: '' });

		const btnPause = el('button', { class: 'ptr_btn', text: '暂停' });
		btnPause.addEventListener('click', () => {
			PTR.paused = !PTR.paused;
			btnPause.textContent = PTR.paused ? '继续' : '暂停';
			PTR.lastFrame = performance.now();
			updateStatus();
		});
		const btnRestart = el('button', { class: 'ptr_btn', text: '重新开始' });
		btnRestart.addEventListener('click', () => { if (PTR.tracer) PTR.tracer.reset(); });
		const btnReload = el('button', { class: 'ptr_btn', text: '重载模型' });
		btnReload.addEventListener('click', () => rebuildScene());
		const btnSave = el('button', { class: 'ptr_btn accent', text: '保存 PNG' });
		btnSave.addEventListener('click', saveImage);
		const btnClose = el('button', { class: 'ptr_btn', text: '关闭' });
		btnClose.addEventListener('click', () => {
			closeRenderer();
			if (PTR.dialog) {
				try { PTR.dialog.close(0); } catch (e) { try { PTR.dialog.hide(); } catch (e2) { } }
			}
		});

		const footer = el('div', { id: 'ptr_footer' }, [
			status, progress, btnPause, btnRestart, btnReload, btnSave, btnClose,
		]);

		const wrapper = el('div', {
			style: { display: 'flex', flexDirection: 'column', height: '68vh', minHeight: '420px' },
		}, [root, footer]);

		PTR.nodes = Object.assign(PTR.nodes || {}, {
			canvas: canvas, overlay: overlay, viewport: viewport, sidebar: sidebar,
			status: status, bar: bar, wrapper: wrapper, btnPause: btnPause,
		});
		root.style.flex = '1 1 auto';
		root.style.minHeight = '0';
		return wrapper;
	}

	function startRenderer() {
		const tracer = new PathTracer(PTR.nodes.canvas);
		tracer.init();
		PTR.tracer = tracer;

		applyResolution();
		tracer.setEnvironment(PTR.settings, PTR.customEnv);
		rebuildScene();

		if (!PTR.camInitialized) {
			if (!PTR.cam.syncFromPreview() && tracer.scene) PTR.cam.frameBounds(tracer.scene.bounds);
			PTR.settings.fov = PTR.cam.fov;
			PTR.settings.ortho = PTR.cam.ortho;
			syncControls();
			PTR.camInitialized = true;
		}
		tracer.setCamera(PTR.cam.state());

		if (window.ResizeObserver) {
			PTR.resizeObs = new ResizeObserver(() => {
				if (PTR.settings.res_mode === 'fit') applyResolution();
			});
			PTR.resizeObs.observe(PTR.nodes.viewport);
		}

		attachViewportEvents(PTR.nodes.canvas);

		PTR.open = true;
		PTR.paused = false;
		PTR.lastFrame = performance.now();
		cancelAnimationFrame(PTR.raf);
		loop();
	}

	function closeRenderer() {
		PTR.open = false;
		cancelAnimationFrame(PTR.raf);
		PTR.raf = 0;
		if (PTR.resizeObs) { try { PTR.resizeObs.disconnect(); } catch (e) { } PTR.resizeObs = null; }
		if (PTR.tracer) { try { PTR.tracer.dispose(); } catch (e) { } PTR.tracer = null; }
		saveSettings();
	}

	function openWindow() {
		if (typeof Dialog === 'undefined') return;
		if (PTR.dialog) {
			closeRenderer();
			try { PTR.dialog.hide(); } catch (e) { }
			try { PTR.dialog.delete(); } catch (e) { }
			PTR.dialog = null;
		}
		const content = buildWindow();
		PTR.dialog = new Dialog('pathtracer_preview_dialog', {
			title: '路径追踪渲染',
			width: 1180,
			resizable: true,
			darken: false,
			cancel_on_click_outside: false,
			buttons: [],
			lines: [content],
			onCancel() { closeRenderer(); },
		});
		PTR.dialog.show();

		setTimeout(() => {
			try {
				if (PTR.dialog && PTR.dialog.object) PTR.dialog.object.classList.add('ptr_dialog_root');
				startRenderer();
			} catch (err) {
				showError(err);
				if (PTR.nodes.overlay) {
					PTR.nodes.overlay.textContent = '初始化失败: ' + (err && err.message ? err.message : err);
				}
			}
		}, 60);
	}


	let action = null;
	let cssHandle = null;
	let eventHandler = null;

	if (typeof window !== 'undefined' && window.__PATHTRACER_TEST__) {
		window.__PATHTRACER_INTERNALS__ = {
			VS_FULLSCREEN, FS_PATHTRACE, FS_DENOISE,
			FS_COMPOSITE, FS_BLOOM_BRIGHT, FS_BLOOM_BLUR, FS_TONEMAP, FS_FINAL,
			PathTracer, buildBVH, buildMaterials, collectGeometry,
			generateSkyPixels, buildEnvDistribution, parseHDR, packAtlas,
			DEFAULTS,
		};
	}

	BBPlugin.register(PLUGIN_ID, {
		title: '路径追踪渲染',
		icon: 'auto_awesome',
		author: 'PuddingKC',
		description: '使用 GPU 路径追踪实时预览并渲染当前模型',
		about: [
			'在 **视图 → 路径追踪渲染** 中打开。',
			'',
			'- 左键拖拽旋转，右键/Shift+左键平移，滚轮缩放',
			'- 支持材质组的 MER / 法线通道；纹理设为“发光”渲染模式会成为光源',
			'- 可载入 `.hdr` 或普通图片作为等距柱状环境贴图',
			'- “阴影捕捉 + 背景透明”可导出带投影的透明 PNG',
			'',
			'需要支持 WebGL2 与 `EXT_color_buffer_float` 的显卡。',
		].join('\n'),
		version: '1.3.0',
		min_version: '4.8.0',
		variant: 'both',
		tags: ['Rendering', 'Preview'],

		onload() {
			loadSettings();
			try { cssHandle = Blockbench.addCSS(CSS); } catch (err) { console.warn('[PathTracer] addCSS 失败', err); }

			action = new Action('pathtracer_preview_open', {
				name: '路径追踪渲染',
				description: '在独立窗口中用路径追踪渲染当前模型',
				icon: 'auto_awesome',
				category: 'view',
				condition: () => typeof Project !== 'undefined' && !!Project,
				click() { openWindow(); },
			});

			try { MenuBar.addAction(action, 'view'); } catch (err) { }
			try { MenuBar.addAction(action, 'tools'); } catch (err) { }

			eventHandler = () => {
				if (!PTR.open || !PTR.tracer) return;
				if (PTR.settings.auto_follow) {
					clearTimeout(PTR.rebuildTimer);
					PTR.rebuildTimer = setTimeout(() => rebuildScene(), 400);
				} else {
					PTR.stale = true;
					updateStatus();
				}
			};
			try {
				Blockbench.on('finished_edit', eventHandler);
				Blockbench.on('undo', eventHandler);
				Blockbench.on('redo', eventHandler);
			} catch (err) { }
		},

		onunload() {
			closeRenderer();
			if (PTR.dialog) { try { PTR.dialog.delete(); } catch (e) { } PTR.dialog = null; }
			if (action) { action.delete(); action = null; }
			if (cssHandle && cssHandle.delete) cssHandle.delete();
			cssHandle = null;
			if (eventHandler) {
				try {
					Blockbench.removeListener('finished_edit', eventHandler);
					Blockbench.removeListener('undo', eventHandler);
					Blockbench.removeListener('redo', eventHandler);
				} catch (err) { }
				eventHandler = null;
			}
		},
	});
})();
