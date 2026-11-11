(function () {
    'use strict';

    const ID = 'pen_3d';
    const MAX_CUBES = 4096, MAX_POINTS = 512, EPSILON = 1e-7;
    const CURVE_DEFAULTS = {curve: 'line', tension: 1, radius: 2, curve_error: 0.05};
    const TUBE_DEFAULTS = {profile: 'square', tube_radius: 1, tube_sides: '16', tube_hollow: true, tube_wall: 0.25};
    const STAMP_DEFAULTS = {generator: 'path', stamp_group: '', stamp_spacing: 2, stamp_align: true, stamp_rotation: [0, 0, 0], stamp_scale: 1};
    const CURVE_OPTIONS = {line: '折线', smooth: '自动平滑曲线', bezier: '贝塞尔', rounded: '自动圆角'};
    let options = {...CURVE_DEFAULTS, ...TUBE_DEFAULTS, ...STAMP_DEFAULTS, width: 1, max_length: 8, step: 0.5, grid: 0.25, mode: 'auto', surface: false};
    let points = [], handles = [], hover = null, pathProject = null, drag = null, generation = null;
    let tool, toolbar, planeSelect, curveSelect, depthSlider, dialog, overlay, frame;
    const items = [], listeners = [];

    function validateOptions(value) {
        value = {...CURVE_DEFAULTS, ...TUBE_DEFAULTS, ...STAMP_DEFAULTS, ...value};
        for (const [key, min, max] of [['width', 0.05, 64], ['max_length', 0.05, 256], ['step', 0.05, 64], ['grid', 0, 64], ['tension', 0, 1], ['radius', 0.05, 256], ['curve_error', 0.005, 1]]) {
            if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) {
                throw new Error(`${key} 必须在 ${min}~${max} 之间。`);
            }
        }
        if (!['auto', 'steps'].includes(value.mode) || typeof value.surface !== 'boolean' || !Object.hasOwn(CURVE_OPTIONS, value.curve)
            || !['path', 'stamp'].includes(value.generator) || typeof value.stamp_group !== 'string') throw new Error('无效的生成设置。');
        if (!['square', 'tube'].includes(value.profile) || !['8', '16'].includes(value.tube_sides)
            || typeof value.tube_hollow !== 'boolean') throw new Error('无效的截面/圆周精度设置。');
        if (!Number.isFinite(value.tube_radius) || value.tube_radius < 0.05 || value.tube_radius > 32) throw new Error('管道外半径必须在 0.05~32 之间。');
        if (!Number.isFinite(value.tube_wall) || value.tube_wall < 0.005 || value.tube_wall > 32) throw new Error('管道壁厚必须在 0.005~32 之间。');
        if (value.profile === 'tube' && value.tube_hollow && value.tube_wall >= value.tube_radius) throw new Error('空心管道壁厚必须小于外半径，实心请关闭空心选项。');
        if (!['path', 'stamp'].includes(value.generator) || !Number.isFinite(value.stamp_spacing) || value.stamp_spacing < 0.05 || value.stamp_spacing > 256
            || typeof value.stamp_align !== 'boolean' || !Number.isFinite(value.stamp_scale) || value.stamp_scale < 0.05 || value.stamp_scale > 16
            || !Array.isArray(value.stamp_rotation) || value.stamp_rotation.length !== 3 || !value.stamp_rotation.every(n => Number.isFinite(n) && Math.abs(n) <= 3600)) {
            throw new Error('无效的模型画笔设置。');
        }
        return {...value};
    }

    function validatePoint(point) {
        if (!Array.isArray(point) || point.length !== 3 || !point.every(n => Number.isFinite(n) && Math.abs(n) <= 100000)) {
            throw new Error('坐标必须是三个有限数字，且绝对值不超过 100000。');
        }
    }

    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

    function tangents(path, config, controls, closed) {
        return path.map((point, i) => {
            if (config.curve === 'bezier' && controls[i]) {
                validatePoint(controls[i]);
                return controls[i].slice();
            }
            const prev = path[i ? i - 1 : closed ? path.length - 1 : 0];
            const next = path[i + 1 < path.length ? i + 1 : closed ? 0 : i];
            const before = distance(point, prev), after = distance(point, next);
            const direction = point.map((v, j) => (before > EPSILON ? (v - prev[j]) / before : 0) + (after > EPSILON ? (next[j] - v) / after : 0));
            const length = Math.hypot(...direction);
            const reach = Math.min(before || after, after || before) * config.tension / 3;
            return direction.map(v => length > EPSILON ? v / length * reach : 0);
        });
    }

    function samplePath(path, config, controls = [], closed = false) {
        config = validateOptions(config);
        if (!Array.isArray(path) || path.length < 2 || path.length > MAX_POINTS) throw new Error(`路径需要 2~${MAX_POINTS} 个点。`);
        path.forEach(validatePoint);
        if (closed && path.length < 3) throw new Error('闭合路径至少需要三个点。');
        if (config.curve === 'line') {
            const samples = closed ? path.concat([path[0]]) : path.slice();
            return {points: samples, segments: samples.slice(1).map((_, i) => i + 1)};
        }

        const anchors = [], keptControls = [];
        path.forEach((point, i) => {
            if (!anchors.length || distance(point, anchors[anchors.length - 1]) > EPSILON) {
                anchors.push(point);
                keptControls.push(controls[i]);
            }
        });
        if (closed && anchors.length > 1 && distance(anchors[0], anchors[anchors.length - 1]) < EPSILON) {
            anchors.pop(); keptControls.pop();
        }
        if (anchors.length < (closed ? 3 : 2)) throw new Error('请添加足够的不同端点。');
        const samples = [], segments = [];
        const append = (point, segment) => {
            if (samples.length && distance(samples[samples.length - 1], point) < EPSILON) return;
            if (samples.length > MAX_CUBES) throw new Error(`曲线采样超过 ${MAX_CUBES} 段，请增大曲线误差/分段长度或缩短路径。`);
            if (samples.length) segments.push(segment);
            samples.push(point);
        };
        const flatness = (point, a, b) => {
            const delta = b.map((v, i) => v - a[i]);
            const length2 = delta.reduce((sum, v) => sum + v * v, 0);
            const t = length2 ? Math.max(0, Math.min(1, delta.reduce((sum, v, i) => sum + v * (point[i] - a[i]), 0) / length2)) : 0;
            return distance(point, mix(a, b, t));
        };
        function cubic(a, c1, c2, b, segment, depth = 0) {
            const polygon = distance(a, c1) + distance(c1, c2) + distance(c2, b);
            if (polygon <= config.max_length && polygon - distance(a, b) <= config.curve_error
                && Math.max(flatness(c1, a, b), flatness(c2, a, b)) <= config.curve_error) {
                append(b, segment);
                return;
            }
            if (depth >= 20) throw new Error('曲线过于复杂，请缩短手柄或增大曲线误差。');
            const ab = mix(a, c1, 0.5), bc = mix(c1, c2, 0.5), cd = mix(c2, b, 0.5);
            const left = mix(ab, bc, 0.5), right = mix(bc, cd, 0.5), middle = mix(left, right, 0.5);
            cubic(a, ab, left, middle, segment, depth + 1);
            cubic(middle, right, cd, b, segment, depth + 1);
        }
        const count = anchors.length;
        if (config.curve === 'rounded') {
            const corners = anchors.map((point, i) => {
                const corner = {start: point, end: point, c1: point, c2: point};
                if (!closed && (i === 0 || i === count - 1)) return corner;
                const prev = anchors[(i + count - 1) % count], next = anchors[(i + 1) % count];
                const before = distance(prev, point), after = distance(point, next);
                const incoming = point.map((v, j) => (v - prev[j]) / before);
                const outgoing = point.map((v, j) => (next[j] - v) / after);
                const cosine = Math.max(-1, Math.min(1, incoming.reduce((sum, v, j) => sum + v * outgoing[j], 0)));

                if (Math.abs(cosine) > 1 - EPSILON) return corner;
                const angle = Math.acos(cosine), halfTan = Math.tan(angle / 2);
                const trim = Math.min(config.radius * halfTan, before * 0.49, after * 0.49);
                const reach = 4 / 3 * (trim / halfTan) * Math.tan(angle / 4);
                corner.start = point.map((v, j) => v - incoming[j] * trim);
                corner.end = point.map((v, j) => v + outgoing[j] * trim);
                corner.c1 = corner.start.map((v, j) => v + incoming[j] * reach);
                corner.c2 = corner.end.map((v, j) => v - outgoing[j] * reach);
                return corner;
            });
            append(corners[0].end, 0);
            for (let i = 1; i < count + (closed ? 1 : 0); i++) {
                const corner = corners[i % count];
                append(corner.start, i);
                cubic(corner.start, corner.c1, corner.c2, corner.end, i);
            }
        } else {
            const vectors = tangents(anchors, config, keptControls, closed);
            append(anchors[0], 0);
            for (let i = 1; i < count + (closed ? 1 : 0); i++) {
                const a = anchors[i - 1], b = anchors[i % count];
                const c1 = a.map((v, j) => v + vectors[i - 1][j]);
                const c2 = b.map((v, j) => v - vectors[i % count][j]);
                validatePoint(c1); validatePoint(c2);
                cubic(a, c1, c2, b, i);
            }
        }
        return {points: samples, segments};
    }

    function stampSource(id) {
        if (!id) throw new Error('请选择要盖印的模型组。');
        const group = Group.all?.find(item => item.uuid === id);
        if (!group || !group.children.length || group.children.some(child => !(child instanceof Cube))) {
            throw new Error('请选择一个直接包含 Cube 的模型组，暂不支持含子组的骨骼层级。');
        }
        return group;
    }

    function stampGroups() {
        return (Group.all || []).filter(group => group.children?.length && group.children.every(child => child instanceof Cube));
    }

    function makeStamps(path, config, controls, closed, format) {
        const source = stampSource(config.stamp_group);
        validatePoint(source.origin); validatePoint(source.rotation);
        if (config.stamp_align && (format.rotation_limit || format.rotation_snap)) {
            throw new Error('沿路径旋转模型画笔需要支持自由旋转的格式，可关闭“沿路径朝向”或改用现代 Java/Bedrock 格式。');
        }
        const sampled = samplePath(path, config, controls, closed).points;
        const segments = [];
        let length = 0;
        for (let i = 1; i < sampled.length; i++) {
            const size = distance(sampled[i - 1], sampled[i]);
            if (size > EPSILON) { segments.push({a: sampled[i - 1], b: sampled[i], size, start: length}); length += size; }
        }
        if (!segments.length) throw new Error('路径长度为零，无法放置模型画笔。');
        const instances = closed ? Math.max(1, Math.ceil((length - EPSILON) / config.stamp_spacing)) : Math.floor((length + EPSILON) / config.stamp_spacing) + 1;
        if (instances * source.children.length > MAX_CUBES) throw new Error(`模型画笔将生成超过 ${MAX_CUBES} 个 Cube，请增大间距或缩短路径。`);
        const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(...config.stamp_rotation.map(n => n * Math.PI / 180), format.euler_order || 'ZYX'));
        const groupRotation = format.bone_rig ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...source.rotation.map(n => n * Math.PI / 180), format.euler_order || 'ZYX')) : new THREE.Quaternion();
        const groupPivot = source.origin.slice();
        const stamps = [];
        for (const cube of source.children) {
            validatePoint(cube.from); validatePoint(cube.to); validatePoint(cube.origin); validatePoint(cube.rotation);
            if (cube.rescale) throw new Error('模型画笔暂不支持启用旋转缩放补偿的 Cube，请先关闭模板的 rescale。');
            if (cube.box_uv && config.stamp_scale !== 1 && !format.optional_box_uv) throw new Error('当前格式要求盒式 UV，缩放会改变贴图布局。请使用缩放 1 或支持逐面 UV 的格式。');
        }
        let segmentIndex = 0;
        let frame = null, previousDirection = null;
        for (let stampIndex = 0; stampIndex < instances; stampIndex++) {
            const along = Math.min(length, stampIndex * config.stamp_spacing);
            while (segmentIndex < segments.length - 1 && along > segments[segmentIndex].start + segments[segmentIndex].size) segmentIndex++;
            const segment = segments[segmentIndex];
            const t = Math.max(0, Math.min(1, (along - segment.start) / segment.size));
            const position = mix(segment.a, segment.b, t);
            const direction = new THREE.Vector3(...segment.b).sub(new THREE.Vector3(...segment.a)).normalize();
            if (config.stamp_align) {
                if (frame) frame.premultiply(new THREE.Quaternion().setFromUnitVectors(previousDirection, direction));
                else frame = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
                frame.normalize();
                previousDirection = direction;
            }
            const rotation = (frame ? frame.clone() : new THREE.Quaternion()).multiply(offset);
            const cubes = source.children.map((cube, sourceIndex) => {
                const cubeOrigin = new THREE.Vector3(...cube.origin);
                const relativeOrigin = cubeOrigin.sub(new THREE.Vector3(...groupPivot)).applyQuaternion(groupRotation).multiplyScalar(config.stamp_scale);
                const origin = new THREE.Vector3(...position).add(relativeOrigin.applyQuaternion(rotation)).toArray();
                const cubeRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...cube.rotation.map(n => n * Math.PI / 180), format.euler_order || 'ZYX'));
                const combined = rotation.clone().multiply(groupRotation).multiply(cubeRotation);
                const euler = new THREE.Euler().setFromQuaternion(combined, format.euler_order || 'ZYX');
                const from = cube.from.map((v, axis) => origin[axis] + (v - cube.origin[axis]) * config.stamp_scale);
                const to = cube.to.map((v, axis) => origin[axis] + (v - cube.origin[axis]) * config.stamp_scale);
                const box = {
                    from, to, origin, rotation: [euler.x, euler.y, euler.z].map(n => n * 180 / Math.PI),
                    segment: stampIndex + 1, stamp_index: stampIndex, source_index: sourceIndex, source_uuid: cube.uuid,
                    stamp_scale: config.stamp_scale, inflate: (cube.inflate || 0) * config.stamp_scale, stretch: cube.stretch?.slice() || [1, 1, 1]
                };
                if (!format.rotate_cubes && box.rotation.some(angle => Math.abs(angle) > EPSILON)) {
                    throw new Error('当前格式不支持 Cube 旋转，模型画笔只能用于支持旋转的格式或使用无旋转模板。');
                }
                if (format.integer_size && to.some((v, axis) => Math.abs(v - from[axis] - Math.round(v - from[axis])) > EPSILON)) throw new Error('当前格式要求整数尺寸，请调整模型画笔缩放。');
                return box;
            });
            for (const cube of cubes) {
                const angles = cube.rotation;
                if (format.rotation_limit && (angles.filter(angle => Math.abs(angle) > EPSILON).length > 1 || angles.some(angle => Math.abs(angle) > 45 + EPSILON))) {
                    throw new Error('当前格式限制 Cube 旋转，无法按此路径朝向模型画笔，关闭“沿路径朝向”并清除不兼容旋转，或切换格式。');
                }
                if (format.rotation_snap && angles.some(angle => Math.abs(angle / 22.5 - Math.round(angle / 22.5)) > EPSILON)) {
                    throw new Error('当前格式的旋转角度只能按 22.5° 增量，无法生成此模型画笔方向。');
                }
            }
            stamps.push({position, rotation, cubes});
        }
        return stamps.flatMap(stamp => stamp.cubes);
    }

    function makeBoxes(path, config, format, controls = [], closed = false) {
        config = {...validateOptions(config)};
        if (config.generator === 'stamp') return makeStamps(path, config, controls, closed, format);
        const tube = config.profile === 'tube';
        if (tube && !format.rotate_cubes) throw new Error('圆形管道需要支持自由旋转的格式，请使用现代 Java/Bedrock 格式或方形截面。');
        if (tube) config.width = config.tube_radius * 2;
        const sampled = samplePath(path, config, controls, closed);
        path = sampled.points;
        const smooth = config.mode === 'auto' && format.rotate_cubes && !format.rotation_limit && !format.rotation_snap;
        const jointExtension = index => {
            if (!smooth || config.curve === 'line' || (!closed && (index === 0 || index === path.length - 1))) return 0;
            const point = path[index], prev = path[index === 0 ? path.length - 2 : index - 1];
            const next = path[index === path.length - 1 ? 1 : index + 1];
            const before = distance(prev, point), after = distance(point, next);
            if (before < EPSILON || after < EPSILON) return 0;
            const cosine = point.reduce((sum, v, j) => sum + (v - prev[j]) * (next[j] - v) / (before * after), 0);

            return Math.min(config.width, config.width * Math.SQRT1_2 * Math.tan(Math.acos(Math.max(-1, Math.min(1, cosine))) / 2));
        };
        const boxes = [];
        for (let segment = 1; segment < path.length; segment++) {
            const a = path[segment - 1], b = path[segment];
            const delta = b.map((v, i) => v - a[i]);
            const length = Math.hypot(...delta);
            if (length < EPSILON) continue;
            const axis = delta.reduce((best, v, i) => Math.abs(v) > Math.abs(delta[best]) ? i : best, 0);
            const aligned = delta.every((v, i) => i === axis || Math.abs(v) < EPSILON);
            const stepped = !smooth && !aligned;
            const connectionStep = tube && config.tube_hollow ? config.tube_wall / 2 : config.width / 2;
            const spacing = stepped ? Math.min(config.max_length, config.step, connectionStep) : config.max_length;
            const count = Math.ceil(length / spacing);
            const pieces = tube ? Number(config.tube_sides) / (config.tube_hollow ? 1 : 2) : 1;
            if ((boxes.length + count) * pieces > MAX_CUBES) throw new Error(`将生成超过 ${MAX_CUBES} 个方块，请降低圆周精度、增大分段长度/阶梯步长或缩短路径。`);
            let rotation = [0, 0, 0];
            if (smooth && !aligned) {
                rotation = format.euler_order === 'XYZ'
                    ? [Math.atan2(delta[2], delta[1]), 0, Math.atan2(-delta[0], Math.hypot(delta[1], delta[2]))]
                    : [Math.atan2(delta[2], Math.hypot(delta[0], delta[1])), 0, Math.atan2(-delta[0], delta[1])];
                rotation = rotation.map(n => n * 180 / Math.PI);
            }
            for (let i = 0; i < count; i++) {
                const extendStart = i === 0 ? jointExtension(segment - 1) : 0;
                const extendEnd = i === count - 1 ? jointExtension(segment) : 0;
                const start = a.map((v, j) => v + delta[j] * (i / count - extendStart / length));
                const end = a.map((v, j) => v + delta[j] * ((i + 1) / count + extendEnd / length));
                const center = start.map((v, j) => (v + end[j]) / 2);
                const rodAxis = smooth && !aligned ? 1 : axis;
                const size = [config.width, config.width, config.width];
                size[rodAxis] = stepped ? Math.abs(delta[axis]) / count : length / count + extendStart + extendEnd;
                boxes.push({
                    from: center.map((v, j) => v - size[j] / 2),
                    to: center.map((v, j) => v + size[j] / 2),
                    origin: center, rotation: rotation.slice(), segment: sampled.segments[segment - 1]
                });
                if (tube) Object.assign(boxes[boxes.length - 1], {rodAxis, direction: delta.map(v => v / length)});
            }
        }
        if (!boxes.length) throw new Error('路径长度为零，请添加不同的端点。');
        const result = tube ? tubeBoxes(boxes, config, format, smooth) : boxes;
        if (format.integer_size && result.some(box => box.to.some((v, i) => Math.abs(v - box.from[i] - Math.round(v - box.from[i])) > EPSILON))) {
            throw new Error('当前格式要求整数尺寸，请使用整数粗细和轴向整数分段，或切换到现代 Bedrock/Java 格式。');
        }
        return result;
    }

    function tubeBoxes(rods, config, format, freeRotation) {
        const sides = Number(config.tube_sides), radius = config.tube_radius;
        const side = 2 * radius * Math.tan(Math.PI / sides);
        const depth = config.tube_hollow ? config.tube_wall : 2 * radius;
        const offset = config.tube_hollow ? radius - depth / 2 : 0;
        const count = config.tube_hollow ? sides : sides / 2;
        const result = [], up = new THREE.Vector3(0, 1, 0);
        let frame = null, previous = null;
        for (const rod of rods) {
            const axis = rod.rodAxis, length = rod.to[axis] - rod.from[axis];
            if (freeRotation) {
                const direction = new THREE.Vector3(...rod.direction);

                if (frame) frame.premultiply(new THREE.Quaternion().setFromUnitVectors(previous, direction));
                else frame = new THREE.Quaternion().setFromUnitVectors(up, direction);
                frame.normalize();
                previous = direction;
            }
            for (let i = 0; i < count; i++) {
                const angle = i * Math.PI * 2 / sides;
                let size, center, rotation;
                if (freeRotation) {
                    const quaternion = frame.clone().multiply(new THREE.Quaternion().setFromAxisAngle(up, angle));
                    const position = new THREE.Vector3(0, 0, offset).applyQuaternion(quaternion);
                    center = rod.origin.map((v, j) => v + position.getComponent(j));
                    size = [side, length, depth];
                    const euler = new THREE.Euler().setFromQuaternion(quaternion, format.euler_order || 'ZYX');
                    rotation = [euler.x, euler.y, euler.z].map(v => v * 180 / Math.PI);
                } else {
                    const x = (axis + 2) % 3, z = (axis + 1) % 3;
                    center = rod.origin.slice();
                    center[x] += Math.sin(angle) * offset;
                    center[z] += Math.cos(angle) * offset;
                    const quarter = Math.floor((i * 360 / sides + 45) / 90);
                    size = [0, 0, 0];
                    size[axis] = length;
                    size[x] = quarter % 2 ? depth : side;
                    size[z] = quarter % 2 ? side : depth;
                    rotation = [0, 0, 0];
                    rotation[axis] = i * 360 / sides - quarter * 90;
                }
                result.push({
                    from: center.map((v, j) => v - size[j] / 2), to: center.map((v, j) => v + size[j] / 2),
                    origin: center, rotation, segment: rod.segment
                });
            }
        }
        return result;
    }

    function createModel(boxes, config = options) {
        if (!Project || !Modes.edit) throw new Error('请先打开模型项目并切换到编辑模式。');
        if (Undo.current_save) throw new Error('请先完成当前编辑操作。');
        const elements = [], groups = [];
        const aspects = {elements, groups, outliner: true, selection: true};
        Undo.initEdit(aspects);
        try {
            const group = new Group({name: 'pen_path', origin: [0, 0, 0]});
            groups.push(group);
            if (group.getTypeBehavior('unique_name')) group.createUniqueName();
            group.init();
            if (config.generator === 'stamp') {
                const source = stampSource(config.stamp_group);
                let stampIndex = -1, copy;
                for (const box of boxes) {
                    if (box.stamp_index !== stampIndex) {
                        stampIndex = box.stamp_index;
                        copy = new Group({name: `stamp_${stampIndex + 1}`, origin: [0, 0, 0], rotation: [0, 0, 0], texture: source.texture, shade: source.shade});
                        groups.push(copy);
                        if (copy.getTypeBehavior('unique_name')) copy.createUniqueName();
                        copy.addTo(group).init();
                    }
                    const template = source.children[box.source_index];
                    if (!(template instanceof Cube) || template.uuid !== box.source_uuid) throw new Error('源模型组在生成过程中发生变化，请重新预览。');
                    const cube = new Cube(template);
                    elements.push(cube);
                    cube.from = box.from.slice();
                    cube.to = box.to.slice();
                    cube.origin = box.origin.slice();
                    cube.rotation = box.rotation.slice();
                    cube.inflate = box.inflate;
                    cube.autouv = 0;
                    if (cube.box_uv && config.stamp_scale !== 1) cube.box_uv = false;
                    cube.addTo(copy).init();
                }
            } else {
                boxes.forEach((box, i) => {
                    const cube = new Cube({
                        name: `pen_${box.segment}_${i + 1}`, from: box.from, to: box.to,
                        origin: box.origin, rotation: box.rotation,
                        autouv: settings.autouv.value ? 1 : 0
                    });
                    elements.push(cube);
                    cube.addTo(group).init();
                    if (!cube.box_uv) cube.mapAutoUV();
                });
            }
            Canvas.updateView({elements, element_aspects: {transform: true, geometry: true, faces: true, uv: true}});
            if (Format.cube_size_limiter && !settings.deactivate_size_limit.value && elements.some(cube => Format.cube_size_limiter.test(cube))) {
                throw new Error('路径模型超出当前格式的尺寸范围，请调整端点/粗细。');
            }
            group.select();
            Undo.finishEdit('3D 钢笔：生成路径模型', aspects);
            return elements;
        } catch (error) {
            Undo.cancelEdit(true);
            Undo.cancelSelection(true);
            throw error;
        }
    }

    function active() {
        return Project && Modes.edit && Toolbox.selected === tool && !Format.image_editor;
    }

    function message(error) {
        Blockbench.showQuickMessage(error.message || String(error), 3500);
    }

    function clearOverlay() {
        if (!overlay) return;
        Canvas.scene.remove(overlay);
        const index = Canvas.gizmos.indexOf(overlay);
        if (index !== -1) Canvas.gizmos.splice(index, 1);
        overlay.traverse(object => {
            if (object.isInstancedMesh) object.dispose();
            if (object.geometry) object.geometry.dispose();
            if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
        });
        overlay = null;
    }

    function reset() {
        points = [];
        handles = [];
        generation = null;
        drag = null;
        hover = null;
        pathProject = null;
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        clearOverlay();
    }

    function updatePreview() {
        frame = undefined;
        clearOverlay();
        if (!active() || (pathProject && pathProject !== Project)) return;
        const current = generation;
        const path = (current ? current.points : points).map(point => point.slice());
        if (!current && hover && (!path.length || Math.hypot(...hover.map((v, i) => v - path[path.length - 1][i])) > EPSILON)) path.push(hover);
        if (!path.length) return;
        const config = current ? current.config : options;
        let boxes = [], invalid = !!current?.invalid, displayPath = path, controls = [];
        try {
            if (path.length > 1 && !invalid) {
                displayPath = samplePath(path, config, current ? current.handles : handles, current?.closed).points;
                boxes = makeBoxes(path, config, Format, current ? current.handles : handles, current?.closed);
            }
            if (config.curve === 'bezier' && !current) controls = handleTargets();
        } catch (_) { invalid = true; }
        overlay = new THREE.Group();
        overlay.no_export = true;
        const color = invalid ? 0xef6464 : 0x58b7ed;
        const geometry = new THREE.BufferGeometry().setFromPoints(displayPath.map(point => new THREE.Vector3(...point)));
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({color, depthTest: false}));
        const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(path.map(point => new THREE.Vector3(...point))), new THREE.PointsMaterial({color, size: 8, sizeAttenuation: false, depthTest: false}));
        line.renderOrder = dots.renderOrder = 100;
        overlay.add(line, dots);
        if (config.curve === 'bezier' && !invalid) {
            const controlPoints = [];
            controls.forEach(control => controlPoints.push(new THREE.Vector3(...points[control.index]), new THREE.Vector3(...control.position)));
            const controlsGeometry = new THREE.BufferGeometry().setFromPoints(controlPoints);
            const controlLines = new THREE.LineSegments(controlsGeometry, new THREE.LineBasicMaterial({color: 0xe5b85c, depthTest: false}));
            const controlDots = new THREE.Points(controlsGeometry.clone(), new THREE.PointsMaterial({color: 0xe5b85c, size: 7, sizeAttenuation: false, depthTest: false}));
            controlLines.renderOrder = controlDots.renderOrder = 101;
            overlay.add(controlLines, controlDots);
        }
        if (boxes.length) {
            const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({color, wireframe: true, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false}), boxes.length);
            const transform = new THREE.Object3D();
            boxes.forEach((box, i) => {
                transform.position.fromArray(box.origin);
                transform.rotation.set(...box.rotation.map(n => n * Math.PI / 180), Format.euler_order || 'ZYX');
                const localCenter = new THREE.Vector3(...box.from.map((v, j) => (v + box.to[j]) / 2 - box.origin[j])).applyQuaternion(transform.quaternion);
                transform.position.add(localCenter);
                transform.scale.set(...box.to.map((v, j) => (v - box.from[j] + (box.inflate || 0) * 2) * (box.stretch?.[j] ?? 1)));
                transform.updateMatrix();
                mesh.setMatrixAt(i, transform.matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
            mesh.frustumCulled = false;
            overlay.add(mesh);
        }
        Canvas.scene.add(overlay);
        Canvas.gizmos.push(overlay);
    }

    function schedulePreview() {
        if (frame === undefined) frame = requestAnimationFrame(updatePreview);
    }

    function pick(event, preview, fixedPlane = null, snapAnchor = points[points.length - 1]) {
        if (options.surface && !fixedPlane) {
            const hit = preview.raycast(event);
            if (hit && hit.element instanceof Cube && hit.intersects && hit.intersects.length) {
                Canvas.scene.updateMatrixWorld(true);
                return snapPoint(Canvas.scene.worldToLocal(hit.intersects[0].point.clone()).toArray(), event);
            }
        }
        const rect = preview.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), preview.camera);
        if (preview.isOrtho) raycaster.ray.origin.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2, -1).unproject(preview.camera);
        let normal;
        const anchor = points.length ? new THREE.Vector3(...points[points.length - 1]) : new THREE.Vector3();
        const depth = Number(depthSlider.get());
        if (!Number.isFinite(depth) || Math.abs(depth) > 100000) return null;
        if (planeSelect.value === 'view') {
            normal = preview.camera.getWorldDirection(new THREE.Vector3());
            anchor.addScaledVector(normal, depth);
        } else {
            const axis = {xy: 2, xz: 1, yz: 0}[planeSelect.value];
            normal = new THREE.Vector3().setComponent(axis, 1);
            anchor.setComponent(axis, depth);
        }
        Canvas.scene.updateMatrixWorld(true);
        const plane = fixedPlane || new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor).applyMatrix4(Canvas.scene.matrixWorld);
        if (Math.abs(raycaster.ray.direction.dot(plane.normal)) < EPSILON) return null;
        const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        return point ? snapPoint(Canvas.scene.worldToLocal(point).toArray(), event, snapAnchor) : null;
    }

    function snapPoint(point, event, anchor = points[points.length - 1]) {
        if (options.grid) point = point.map(v => Math.round(v / options.grid) * options.grid);
        if (event.shiftKey && anchor) {
            const delta = point.map((v, i) => v - anchor[i]);
            const axis = delta.reduce((best, v, i) => Math.abs(v) > Math.abs(delta[best]) ? i : best, 0);
            point = point.map((v, i) => i === axis ? v : anchor[i]);
        }
        return point;
    }

    function addPoint(point) {
        validatePoint(point);
        if (pathProject && pathProject !== Project) reset();
        if (points.length >= MAX_POINTS - 1) throw new Error(`一条路径最多 ${MAX_POINTS - 1} 个点，请先生成后继续。`);
        const last = points[points.length - 1];
        if (last && Math.hypot(...point.map((v, i) => v - last[i])) < EPSILON) return;
        const next = points.concat([point.slice()]);
        if (next.length > 1) makeBoxes(next, options, Format, handles);
        pathProject = Project;
        points = next;
        handles.push(null);
        hover = null;
        schedulePreview();
    }

    function generationForm(config) {
        return {
            generator: {label: '生成模式', type: 'select', value: config.generator, options: {path: '路径方块/圆管', stamp: '模型画笔'}},
            stamp_group: {label: '模型组', type: 'outliner_node', value: config.stamp_group, getOutlinerNodes: () => stampGroups(), condition: form => form.generator === 'stamp'},
            stamp_spacing: {label: '画笔间距', type: 'number', value: config.stamp_spacing, min: 0.05, max: 256, step: 0.25, condition: form => form.generator === 'stamp'},
            stamp_align: {label: '沿路径朝向', type: 'checkbox', value: config.stamp_align, condition: form => form.generator === 'stamp'},
            stamp_rotation: {label: '旋转偏移 X / Y / Z', type: 'vector', dimensions: 3, value: config.stamp_rotation, step: 1, condition: form => form.generator === 'stamp'},
            stamp_scale: {label: '模型缩放', type: 'number', value: config.stamp_scale, min: 0.05, max: 16, step: 0.05, condition: form => form.generator === 'stamp'},
            curve: {label: '路径形状', type: 'select', value: config.curve, options: CURVE_OPTIONS},
            profile: {label: '模型截面', type: 'select', value: config.profile, options: {square: '方形', tube: '圆形管道'}, condition: form => form.generator === 'path'},
            width: {label: '方形线条粗细', type: 'number', value: config.width, min: 0.05, max: 64, step: 0.25, condition: form => form.generator === 'path' && form.profile === 'square'},
            tube_radius: {label: '管道外半径', type: 'number', value: config.tube_radius, min: 0.05, max: 32, step: 0.25, condition: form => form.generator === 'path' && form.profile === 'tube'},
            tube_sides: {label: '圆周精度', type: 'select', value: config.tube_sides, options: {'8': '八边形', '16': '十六边形'}, condition: form => form.generator === 'path' && form.profile === 'tube'},
            tube_hollow: {label: '空心管道', type: 'checkbox', value: config.tube_hollow, condition: form => form.generator === 'path' && form.profile === 'tube'},
            tube_wall: {label: '管道壁厚', type: 'number', value: config.tube_wall, min: 0.005, max: 32, step: 0.05, condition: form => form.generator === 'path' && form.profile === 'tube' && form.tube_hollow},
            max_length: {label: '最大分段长度', type: 'number', value: config.max_length, min: 0.05, max: 256, step: 1},
            curve_error: {label: '曲线采样误差', type: 'number', value: config.curve_error, min: 0.005, max: 1, step: 0.01},
            tension: {label: '自动手柄强度', type: 'number', value: config.tension, min: 0, max: 1, step: 0.1},
            radius: {label: '转角圆角半径', type: 'number', value: config.radius, min: 0.05, max: 256, step: 0.25},
            mode: {label: '生成方式', type: 'select', value: config.mode, options: {auto: '自动', steps: '阶梯方块'}, condition: form => form.generator === 'path'},
            step: {label: '阶梯最大步长', type: 'number', value: config.step, min: 0.05, max: 64, step: 0.25, condition: form => form.generator === 'path'}
        };
    }

    function finish(closed = false) {
        if (!active() || pathProject !== Project || generation || Dialog.open) return;
        try {
            if (closed && points.length < 3) throw new Error('闭合路径至少需要三个点。');
            if (drag) pointerUp();
            const pending = generation = {
                project: Project, points: points.map(point => point.slice()), handles: handles.map(handle => handle?.slice() || null),
                closed, config: {...options}, invalid: false, count: 0, status: null, dialog: null
            };
            const update = form => {
                try {
                    const config = validateGenerationForm(pending, form);
                    const boxes = makeBoxes(pending.points, config, Format, pending.handles, pending.closed);
                    pending.config = config;
                    pending.invalid = false;
                    pending.count = boxes.length;
                    if (pending.status) pending.status.textContent = `${boxes.length.toLocaleString()} 个方块`;
                } catch (error) {
                    pending.invalid = true;
                    if (pending.status) pending.status.textContent = error.message;
                }
                schedulePreview();
            };
            pending.dialog = dialog = new Dialog({
                id: 'pen_3d_generation', title: '生成预览', width: 460,
                buttons: ['dialog.confirm', 'dialog.cancel'], form: generationForm(pending.config),
                onBuild(object) {
                    pending.status = document.createElement('p');
                    pending.status.className = 'small_text subtle';
                    object.querySelector('.dialog_content').append(pending.status);
                    update(pending.config);
                },
                onFormChange: update,
                onConfirm(form) {
                    try {
                        if (generation !== pending || Project !== pending.project || !active()) throw new Error('项目或路径已改变，请重新确认。');
                        const config = validateGenerationForm(pending, form);
                        if (config.generator === 'stamp' && !config.stamp_group) throw new Error('请选择要盖印的模型组。');
                        const boxes = makeBoxes(pending.points, config, Format, pending.handles, pending.closed);
                        createModel(boxes, config);
                        options = config;
                        curveSelect.set(options.curve);
                        generation = null;
                        reset();
                        if (dialog === pending.dialog) dialog = null;
                    } catch (error) {
                        pending.invalid = true;
                        if (pending.status) pending.status.textContent = error.message;
                        schedulePreview();
                        message(error);
                        return false;
                    }
                },
                onCancel() {
                    if (generation === pending) generation = null;
                    if (dialog === pending.dialog) dialog = null;
                    schedulePreview();
                }
            }).show();
        } catch (error) { message(error); }
    }

    function validateGenerationForm(pending, form) {
        const config = {...pending.config, curve: form.curve || pending.config.curve, max_length: form.max_length ?? pending.config.max_length,
            curve_error: form.curve_error ?? pending.config.curve_error, tension: form.tension ?? pending.config.tension,
            radius: form.radius ?? pending.config.radius};
        config.generator = form.generator || pending.config.generator || 'path';
        if (config.generator === 'path') {
            Object.assign(config, STAMP_DEFAULTS, {generator: 'path'});
            config.mode = form.mode || pending.config.mode || 'auto';
            config.step = config.mode === 'steps'
                ? (Number.isFinite(form.step) ? form.step : pending.config.step)
                : pending.config.step;
            config.profile = form.profile || pending.config.profile || 'square';
            if (config.profile === 'tube') {
                config.width = CURVE_DEFAULTS.width ?? 1;
                for (const key of ['tube_radius', 'tube_sides', 'tube_hollow', 'tube_wall']) {
                    config[key] = form[key] ?? pending.config[key] ?? TUBE_DEFAULTS[key];
                }
            } else {
                config.width = form.width ?? pending.config.width;
                Object.assign(config, TUBE_DEFAULTS);
            }
        } else {
            Object.assign(config, TUBE_DEFAULTS, STAMP_DEFAULTS, {generator: 'stamp', profile: 'square'});
            config.stamp_group = form.stamp_group || pending.config.stamp_group || '';
            for (const key of ['stamp_spacing', 'stamp_align', 'stamp_scale', 'stamp_rotation']) {
                config[key] = form[key] ?? pending.config[key] ?? STAMP_DEFAULTS[key];
            }
        }
        return validateOptions(config);
    }

    function removePoint() {
        if (drag) pointerCancel({pointerId: drag.pointerId});
        points.pop();
        handles.pop();
        hover = null;
        schedulePreview();
    }

    function previewFor(event) {
        return Preview.all.find(preview => preview.canvas === event.target);
    }

    function handleTargets() {
        const targets = [];
        tangents(points, options, handles, false).forEach((vector, index) => {
            for (const sign of [-1, 1]) {
                if (index === 0 && sign === -1) continue;
                targets.push({index, sign, position: points[index].map((v, i) => v + sign * vector[i])});
            }
        });
        return targets;
    }

    function hitHandle(event, preview) {
        if (options.curve !== 'bezier' || !points.length) return null;
        Canvas.scene.updateMatrixWorld(true);
        preview.camera.updateMatrixWorld(true);
        const rect = preview.canvas.getBoundingClientRect();
        const nearest = targets => {
            let hit = null, best = 9;
            for (const target of targets) {
                const screen = new THREE.Vector3(...target.position).applyMatrix4(Canvas.scene.matrixWorld).project(preview.camera);
                if (screen.z < -1 || screen.z > 1) continue;
                const pixels = Math.hypot(rect.left + (screen.x + 1) * rect.width / 2 - event.clientX,
                    rect.top + (1 - screen.y) * rect.height / 2 - event.clientY);
                if (pixels < best) { best = pixels; hit = target; }
            }
            return hit;
        };
        try { return nearest(handleTargets()) || nearest(points.map((position, index) => ({index, sign: 1, position}))); }
        catch (_) { return null; }
    }

    function handlePlane(position, preview, faceCamera) {
        const normal = faceCamera || planeSelect.value === 'view' ? preview.camera.getWorldDirection(new THREE.Vector3())
            : new THREE.Vector3().setComponent({xy: 2, xz: 1, yz: 0}[planeSelect.value], 1);
        Canvas.scene.updateMatrixWorld(true);
        return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(...position)).applyMatrix4(Canvas.scene.matrixWorld);
    }

    function rotateView(event) {
        const {preview} = drag, controls = preview.controls;
        if (!controls || controls.enabled === false || (!controls.enableRotate && preview.angle == null)) return;
        if (preview.angle != null) preview.setProjectionMode(false, true);
        const rect = preview.canvas.getBoundingClientRect();
        const scale = 2 * Math.PI / Math.max(600, Math.min(1200, rect.width + rect.height)) * controls.rotateSpeed;
        controls.rotateLeft((event.clientX - drag.lastX) * scale);
        controls.rotateUp((event.clientY - drag.lastY) * scale);
        controls.hasMoved = true;
        controls.update();
        preview.camera.updateMatrixWorld(true);
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
    }

    function panView(event) {
        const {preview} = drag, controls = preview.controls, camera = preview.camera;
        if (!controls || controls.enabled === false || controls.enablePan === false) return;
        const rect = preview.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const dx = event.clientX - drag.lastX, dy = event.clientY - drag.lastY;
        if (camera.isPerspectiveCamera) {
            const scale = 2 * camera.position.distanceTo(controls.target) * Math.tan(camera.fov * Math.PI / 360) / rect.height;
            controls.panLeft(dx * scale, camera.matrix);
            controls.panUp(dy * scale, camera.matrix);
        } else {
            controls.panLeft(dx * (camera.right - camera.left) / camera.zoom / rect.width, camera.matrix);
            controls.panUp(dy * (camera.top - camera.bottom) / camera.zoom / rect.height, camera.matrix);
        }
        controls.hasMoved = true;
        controls.update();
        camera.updateMatrixWorld(true);
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
    }

    function pointerDown(event) {
        if (!active() || Dialog.open || drag || ![0, 1, 2].includes(event.button)) return;
        const preview = previewFor(event);
        if (!preview) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        Preview.selected = preview;
        document.activeElement?.blur();
        const gesture = {preview, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
            lastX: event.clientX, lastY: event.clientY, moved: false};
        try {
            if (event.button !== 0 || event.altKey) {
                drag = {...gesture, kind: event.button === 2 ? 'back' : event.button === 1 ? 'pan' : 'orbit'};
                hover = null;
                schedulePreview();
                return;
            }
            const target = hitHandle(event, preview);
            if (target) {
                const plane = handlePlane(target.position, preview, true);
                const grab = pick(event, preview, plane, points[target.index]);
                if (!grab) return;
                drag = {...gesture, ...target, kind: 'handle', plane, grab,
                    base: tangents(points, options, handles, false)[target.index], previous: handles[target.index]?.slice() || null};
                hover = null;
                schedulePreview();
                return;
            }
            const point = pick(event, preview);
            if (options.curve !== 'bezier') {
                drag = {...gesture, kind: 'click', point};
                return;
            }
            if (!point) throw new Error('射线与工作平面平行或平面在相机后方，请旋转视图或切换工作平面。');
            const previousCount = points.length;
            addPoint(point);
            if (options.curve === 'bezier' && points.length > previousCount) {
                drag = {
                    ...gesture, kind: 'handle', index: points.length - 1, sign: 1, position: point, grab: point,
                    plane: handlePlane(point, preview, false), base: [0, 0, 0], previous: null
                };
            }
        } catch (error) { message(error); }
    }

    function pointerMove(event) {
        if (!active() || Dialog.open) return;
        if (drag) {
            if (event.pointerId !== drag.pointerId) return;
            if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return;
            drag.moved = true;
            hover = null;
            if (drag.kind === 'back') return;
            if (drag.kind === 'click') drag.kind = 'orbit';
            if (drag.kind === 'orbit' || drag.kind === 'pan') {
                if (drag.kind === 'pan') panView(event);
                else rotateView(event);
                schedulePreview();
                return;
            }
            const point = pick(event, drag.preview, drag.plane, points[drag.index]);
            if (point) {
                handles[drag.index] = point.map((v, i) => drag.base[i] + (v - drag.grab[i]) * drag.sign);
                schedulePreview();
            }
            return;
        }
        const preview = previewFor(event);
        hover = preview && !event.buttons && !hitHandle(event, preview) ? pick(event, preview) : null;
        if (hover || overlay) schedulePreview();
    }

    function pointerUp(event) {
        if (!drag || (event && event.pointerId !== drag.pointerId)) return;
        const {index, moved, kind, point, previous} = drag;
        drag = null;
        if (kind === 'back') {
            if (!moved) removePoint();
        } else if (kind === 'click') {
            try {
                if (!point) throw new Error('射线与工作平面平行或平面在相机后方，请旋转视图或切换工作平面。');
                addPoint(point);
            } catch (error) { message(error); }
        } else if (kind === 'handle' && moved) {
            try {
                validatePoint(handles[index]);
                if (points.length > 1) makeBoxes(points, options, Format, handles);
            }
            catch (error) { handles[index] = previous; message(error); }
        }
        schedulePreview();
    }

    function pointerCancel(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (drag.kind === 'handle') handles[drag.index] = drag.previous;
        drag = null;
        hover = null;
        schedulePreview();
    }

    function doubleClick(event) {
        if (active() && !event.altKey && previewFor(event)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }

    function contextMenu(event) {
        if (active() && !Dialog.open && previewFor(event)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }

    function closeDialog() {
        if (dialog) {
            const closing = dialog;
            dialog = null;
            if (generation?.dialog === closing) generation = null;
            closing.hide();
            closing.delete();
            schedulePreview();
        }
    }

    function openSettings() {
        closeDialog();
        dialog = new Dialog({
            id: 'pen_3d_settings', title: '3D 钢笔设置', width: 480,
            form: {
                generator: {label: '生成模式', type: 'select', value: options.generator, options: {path: '路径方块/圆管', stamp: '模型画笔'}},
                stamp_group: {label: '模型组', type: 'outliner_node', value: options.stamp_group, getOutlinerNodes: () => stampGroups(), condition: form => form.generator === 'stamp'},
                stamp_spacing: {label: '画笔间距', type: 'number', value: options.stamp_spacing, min: 0.05, max: 256, step: 0.25, condition: form => form.generator === 'stamp'},
                stamp_align: {label: '沿路径朝向', type: 'checkbox', value: options.stamp_align, condition: form => form.generator === 'stamp'},
                stamp_rotation: {label: '旋转偏移 X / Y / Z', type: 'vector', dimensions: 3, value: options.stamp_rotation, step: 1, condition: form => form.generator === 'stamp'},
                stamp_scale: {label: '模型缩放', type: 'number', value: options.stamp_scale, min: 0.05, max: 16, step: 0.05, condition: form => form.generator === 'stamp'},
                curve: {label: '路径形状', type: 'select', value: options.curve, options: CURVE_OPTIONS},
                profile: {label: '模型截面', type: 'select', value: options.profile, options: {square: '方形', tube: '圆形管道'}, condition: form => form.generator === 'path'},
                width: {label: '方形线条粗细', type: 'number', value: options.width, min: 0.05, max: 64, step: 0.25, condition: form => form.generator === 'path' && form.profile === 'square'},
                tube_radius: {label: '管道外半径（中心到外侧平面）', type: 'number', value: options.tube_radius, min: 0.05, max: 32, step: 0.25, condition: form => form.generator === 'path' && form.profile === 'tube'},
                tube_sides: {label: '圆周精度', type: 'select', value: options.tube_sides, options: {'8': '八边形', '16': '十六边形'}, condition: form => form.generator === 'path' && form.profile === 'tube'},
                tube_hollow: {label: '空心管道', type: 'checkbox', value: options.tube_hollow, condition: form => form.generator === 'path' && form.profile === 'tube'},
                tube_wall: {label: '管道壁厚', type: 'number', value: options.tube_wall, min: 0.005, max: 32, step: 0.05, condition: form => form.generator === 'path' && form.profile === 'tube' && form.tube_hollow},
                max_length: {label: '最大分段长度', type: 'number', value: options.max_length, min: 0.05, max: 256, step: 1},
                curve_error: {label: '曲线采样误差（越小越平滑）', type: 'number', value: options.curve_error, min: 0.005, max: 1, step: 0.01},
                tension: {label: '自动手柄强度', type: 'number', value: options.tension, min: 0, max: 1, step: 0.1},
                radius: {label: '圆角半径', type: 'number', value: options.radius, min: 0.05, max: 256, step: 0.25},
                mode: {label: '生成方式', type: 'select', value: options.mode, options: {auto: '自动（受限格式使用阶梯）', steps: '阶梯方块'}, condition: form => form.generator === 'path'},
                step: {label: '阶梯最大步长', type: 'number', value: options.step, min: 0.05, max: 64, step: 0.25, condition: form => form.generator === 'path'},
                grid: {label: '坐标吸附网格（0 关闭）', type: 'number', value: options.grid, min: 0, max: 64, step: 0.25},
                surface: {label: '优先吸附已有 Cube 表面', type: 'checkbox', value: options.surface}
            },
            onConfirm(form) {
                try {
                    const next = validateOptions(form);
                    if (points.length > 1) makeBoxes(points, next, Format, handles);
                    if (drag) pointerCancel({pointerId: drag.pointerId});
                    options = next;
                    curveSelect.set(options.curve);
                    hover = null;
                    schedulePreview();
                } catch (error) { message(error); return false; }
            }
        }).show();
    }

    function openHandleDialog() {
        if (!points.length) { message('请先添加一个端点。'); return; }
        closeDialog();
        const project = Project, index = points.length - 1;
        const vector = tangents(points, {...options, curve: 'bezier'}, handles, false)[index];
        dialog = new Dialog({
            id: 'pen_3d_handle', title: '末端点贝塞尔手柄', width: 440,
            form: {
                offset: {label: '出手柄相对偏移 X / Y / Z', type: 'vector', dimensions: 3, value: vector, step: 0.25},
                auto: {label: '恢复自动手柄', type: 'checkbox', value: false},
                info: {type: 'info', text: '双侧对称，零偏移为尖角，确认后切换至贝塞尔模式。'}
            },
            onConfirm(form) {
                try {
                    if (!active() || Project !== project || index !== points.length - 1) throw new Error('当前路径已改变，请重新设置手柄。');
                    validatePoint(form.offset);
                    const next = handles.slice();
                    next[index] = form.auto ? null : form.offset.slice();
                    const config = {...options, curve: 'bezier'};
                    if (points.length > 1) makeBoxes(points, config, Format, next);
                    handles = next;
                    options = config;
                    curveSelect.set('bezier');
                    hover = null;
                    schedulePreview();
                } catch (error) { message(error); return false; }
            }
        }).show();
    }

    function openPointDialog() {
        closeDialog();
        const project = Project;
        dialog = new Dialog({
            id: 'pen_3d_point', title: '添加精确三维端点', width: 420,
            form: {point: {label: '模型坐标 X / Y / Z', type: 'vector', dimensions: 3, value: points.length ? points[points.length - 1].slice() : [0, 0, 0], step: 0.25}},
            onConfirm(form) {
                try {
                    if (!active() || Project !== project) throw new Error('当前项目已改变，请重新添加端点。');
                    addPoint(form.point);
                } catch (error) { message(error); return false; }
            }
        }).show();
    }

    function register() {
        const condition = () => Project && Modes.edit && !Format.image_editor;
        curveSelect = new BarSelect('pen_3d_curve', {
            name: '钢笔路径形状', value: options.curve, options: CURVE_OPTIONS,
            onChange(select) {
                try {
                    const next = {...options, curve: select.value};
                    if (points.length > 1) makeBoxes(points, next, Format, handles);
                    if (drag) pointerCancel({pointerId: drag.pointerId});
                    options = next;
                    hover = null;
                    schedulePreview();
                } catch (error) { select.set(options.curve); message(error); }
            }
        });
        planeSelect = new BarSelect('pen_3d_plane', {
            name: '钢笔工作平面', value: 'view',
            options: {view: '视图平面', xy: 'XY（固定 Z）', xz: 'XZ（固定 Y）', yz: 'YZ（固定 X）'},
            onChange() { hover = null; schedulePreview(); }
        });
        depthSlider = new NumSlider('pen_3d_depth', {
            name: '平面深度/偏移', settings: {default: 0, min: -100000, max: 100000, step: 0.25},
            onChange() { hover = null; schedulePreview(); }
        });
        items.push(curveSelect, planeSelect, depthSlider);
        for (const [suffix, name, icon, click] of [
            ['settings', '钢笔设置', 'settings', openSettings],
            ['point', '添加坐标点', 'add_location_alt', openPointDialog],
            ['handle', '末点贝塞尔手柄', 'timeline', openHandleDialog],
            ['back', '删除末点', 'backspace', removePoint],
            ['finish', '生成路径', 'check', () => finish()],
            ['close', '闭合并生成', 'pentagon', () => finish(true)],
            ['cancel', '取消路径', 'close', reset]
        ]) items.push(new Action(`${ID}_${suffix}`, {name, icon, condition, click}));
        toolbar = new Toolbar({id: ID, name: '3D 钢笔', children: items.map(item => item.id)});

        if (!toolbar.children.length) toolbar.reset();
        tool = new Tool('pen_3d_tool', {
            name: '3D 钢笔', icon: 'draw', category: 'tools', description: 'Enter 打开生成预览，左键加点，右键删除。支持路径绘制及指定模型组画笔。',
            toolbar: ID, transformerMode: 'hidden', selectElements: false, cursor: 'crosshair', modes: ['edit'], condition,
            onSelect() {
                reset();
                toolbar.update().toPlace('tool_options');
            },
            onCanvasRightClick() { return false; },
            onUnselect() { reset(); closeDialog(); }
        });
        Toolbars.tools.add(tool);
        MenuBar.addAction(tool, 'tools');
        document.addEventListener('pointerdown', pointerDown, true);
        document.addEventListener('pointermove', pointerMove, true);
        document.addEventListener('pointerup', pointerUp, true);
        document.addEventListener('pointercancel', pointerCancel, true);
        document.addEventListener('dblclick', doubleClick, true);
        document.addEventListener('contextmenu', contextMenu, true);
        listeners.push(Blockbench.on('press_key', context => {
            if (!active() || context.input_in_focus || Dialog.open) return;
            const event = context.event;
            if (event.ctrlKey || event.metaKey || event.altKey || !['Enter', 'Escape', 'Backspace'].includes(event.key)) return;
            context.capture();
            if (event.key === 'Enter') finish();
            else if (event.key === 'Backspace') removePoint();
            else if (drag) pointerCancel({pointerId: drag.pointerId});
            else reset();
        }));
        for (const event of ['unselect_project', 'unselect_mode', 'convert_format']) {
            listeners.push(Blockbench.on(event, () => { reset(); closeDialog(); }));
        }
    }

    BBPlugin.register(ID, {
        title: '3D Pen', author: 'PuddingKC', icon: 'draw',
        description: '三维路径建模与模型组画笔，支持折线、贝塞尔、圆形管道及沿路径盖印。',
        about: [
			'在编辑模式顶部工具栏 **3D 钢笔** 打开',
            '',
            '- 左键添加路径点，右键删除最后添加的点。',
            '- 中键平移视图，Alt＋左键旋转视图。',
            '- 按 Enter 生成模型，Esc 取消路径。',
            '- 在生成预览中选择模型画笔，可沿路径重复盖印指定模型组。',
            '',
            '- 当前为测试版插件，使用中如遇到问题请在 GitHub 提交 Issue。',
            '',
			'官方更新地址：https://github.com/Null-K/blockbench-plugins'
		].join('\n'),
        version: '1.5.1', min_version: '4.10.0', variant: 'both',
        onload: register,
        onunload() {
            reset();
            closeDialog();
            if (Toolbox.selected === tool) BarItems.move_tool.select();
            document.removeEventListener('pointerdown', pointerDown, true);
            document.removeEventListener('pointermove', pointerMove, true);
            document.removeEventListener('pointerup', pointerUp, true);
            document.removeEventListener('pointercancel', pointerCancel, true);
            document.removeEventListener('dblclick', doubleClick, true);
            document.removeEventListener('contextmenu', contextMenu, true);
            listeners.splice(0).forEach(listener => listener.delete());
            tool.delete();
            items.splice(0).forEach(item => {
                const index = item.toolbars.indexOf(toolbar);
                if (index !== -1) item.toolbars.splice(index, 1);
                item.delete();
            });
            toolbar.node.remove();
            delete Toolbars[ID];
        }
    });

    if (typeof globalThis !== 'undefined' && globalThis.__PEN_3D_TEST__) {
        globalThis.__PEN_3D_INTERNALS__ = {validateOptions, samplePath, tangents, makeBoxes, createModel, snapPoint, pick, addPoint, finish, reset, updatePreview,
            getState: () => ({points, handles, hover, pathProject, drag}), getOptions: () => options};
    }
})();
