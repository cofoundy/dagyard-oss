"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
// La banda dibujada de verdad: el árbol tiene que validar en terminal y en desktop.
var testing_1 = require("claude-code/testing");
var PLUGIN = 'dagyard';
var Box = 'Box';
var BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20 } };
var SNAP = {
    project: { id: 'marketplace-reservas', name: 'Marketplace de reservas', stages: [{ id: 'diseno', name: 'Diseño' }, { id: 'lanzamiento', name: 'Lanzamiento' }] },
    nodes: [
        { id: 'comision', title: 'Modelo de comisiones', stage: 'diseno', status: 'blocked', team: 'Diseño', goal: null },
        { id: 'landing', title: 'Página de lanzamiento', stage: 'lanzamiento', status: 'pending', team: null, goal: 'Arma la página de lanzamiento' },
    ],
    edges: [],
    blockers: [
        { id: 'b1', nodeId: 'comision', kind: 'decision', question: '¿A quién le cobramos?', options: ['Al proveedor', 'Al cliente'], accessLabel: null, status: 'open' },
        { id: 'b2', nodeId: 'comision', kind: 'review', question: 'Revisa el diseño', options: ['Aprobar', 'Pedir cambios'], accessLabel: null, status: 'open' },
        { id: 'b3', nodeId: 'comision', kind: 'access', question: 'Necesito la pasarela', options: [], accessLabel: 'Clave de la pasarela', status: 'open' },
    ],
};
var LINKED = { '/w/.dagyard.json': JSON.stringify({ project: 'marketplace-reservas' }) };
function world(on, ok) {
    var _a;
    if (ok === void 0) { ok = true; }
    var o = typeof ok === 'boolean' ? { ok: ok } : ok;
    var files = (_a = o.files) !== null && _a !== void 0 ? _a : LINKED;
    var clock = testing_1.mock.clock(on);
    testing_1.mock.store(on);
    testing_1.mock.env(on, __assign({ HOME: '/h' }, o.env));
    var calls = [];
    var sent = [];
    var toasts = [];
    on('session.start', function ($, e) { return ({ cwd: e.cwd }); });
    on('command.register', function ($, e) { return ({ value: { command: e.name } }); });
    on('fs.read', function ($, e) {
        var path = String(e.path);
        if (/\/h\/\.config\/dagyard\/(agent-key|owner-token)$/.test(path))
            return { value: 'k' };
        return path in files ? { value: files[path] } : { deny: 'missing' };
    });
    var bodies = [];
    var keys = [];
    on('http.fetch', function ($, e) {
        var _a, _b, _c, _d, _e, _f;
        var method = (_b = (_a = e.init) === null || _a === void 0 ? void 0 : _a.method) !== null && _b !== void 0 ? _b : 'GET';
        calls.push("".concat(method, " ").concat(e.url));
        if ((_c = e.init) === null || _c === void 0 ? void 0 : _c.body)
            bodies.push(e.init.body);
        if (method !== 'GET')
            keys.push((_e = (_d = e.init) === null || _d === void 0 ? void 0 : _d.headers) === null || _e === void 0 ? void 0 : _e['idempotency-key']);
        var r = (_f = o.respond) === null || _f === void 0 ? void 0 : _f.call(o, method, e.url);
        if (r === 'cut')
            return { deny: 'sin red' };
        if (r)
            return { value: r };
        if (o.ok === false)
            return { value: { status: 403, ok: false, headers: {}, text: '' } };
        return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(o.snap ? o.snap() : SNAP) } };
    });
    on('ui.render', function () { return <Box key="engine"/>; });
    on('ui.toast', function ($, e) {
        toasts.push(e.text);
        return { value: undefined };
    });
    on('command.run', function ($, e) {
        sent.push("/".concat(e.command, " ").concat(e.args));
        return { text: '' };
    });
    on('ui.open', function () { return ({ value: { isPlaced: true } }); });
    on('process.run', function () { return ({ value: { exitCode: 0, stdout: '', stderr: '' } }); });
    return { calls: calls, sent: sent, bodies: bodies, keys: keys, toasts: toasts, clock: clock };
}
var MENU = { component: 'Pane', requestId: 'dagyard-menu', props: {} };
var start = function ($, cwd) {
    if (cwd === void 0) { cwd = '/w'; }
    return $.session.start({ cwd: cwd, surface: 'terminal', isInteractive: true });
};
(0, testing_1.describe)('banda de dagyard', function () {
    (0, testing_1.test)('dibuja lo que te espera con sus opciones', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var _i, _a, surface, ui, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    world(on);
                    return [4 /*yield*/, start($)];
                case 1:
                    _d.sent();
                    _i = 0, _a = ['terminal', 'desktop'];
                    _d.label = 2;
                case 2:
                    if (!(_i < _a.length)) return [3 /*break*/, 8];
                    surface = _a[_i];
                    return [4 /*yield*/, $.ui.mount(__assign({ plugin: PLUGIN, surface: surface }, BAND))];
                case 3:
                    ui = _d.sent();
                    _b = testing_1.expect;
                    return [4 /*yield*/, ui.find({ type: 'Text', text: /Modelo de comisiones/ })];
                case 4:
                    _b.apply(void 0, [_d.sent()]).toBeDefined();
                    _c = testing_1.expect;
                    return [4 /*yield*/, ui.find({ key: 'dy-opt-0' })];
                case 5:
                    _c.apply(void 0, [_d.sent()]).toBeDefined();
                    return [4 /*yield*/, ui.unmount()];
                case 6:
                    _d.sent();
                    _d.label = 7;
                case 7:
                    _i++;
                    return [3 /*break*/, 2];
                case 8: return [2 /*return*/];
            }
        });
    }); });
    (0, testing_1.test)('Otra pasa a lo que está para tomar y Trabajar en esto fija el /goal', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var sent, ui, i, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    sent = world(on).sent;
                    return [4 /*yield*/, start($)];
                case 1:
                    _b.sent();
                    return [4 /*yield*/, $.ui.mount(__assign({ plugin: PLUGIN, surface: 'terminal' }, BAND))];
                case 2:
                    ui = _b.sent();
                    i = 0;
                    _b.label = 3;
                case 3:
                    if (!(i < 3)) return [3 /*break*/, 6];
                    return [4 /*yield*/, ui.press({ key: 'dy-next' })];
                case 4:
                    _b.sent();
                    _b.label = 5;
                case 5:
                    i++;
                    return [3 /*break*/, 3];
                case 6:
                    _a = testing_1.expect;
                    return [4 /*yield*/, ui.find({ key: 'dy-take' })];
                case 7:
                    _a.apply(void 0, [_b.sent()]).toBeDefined();
                    return [4 /*yield*/, ui.press({ key: 'dy-take' })];
                case 8:
                    _b.sent();
                    (0, testing_1.expect)(sent).toContain('/goal Arma la página de lanzamiento');
                    return [4 /*yield*/, ui.unmount()];
                case 9:
                    _b.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, testing_1.test)('sin conexión lo dice en vez de desaparecer', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var ui, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    world(on, false);
                    return [4 /*yield*/, start($)];
                case 1:
                    _b.sent();
                    return [4 /*yield*/, $.ui.mount(__assign({ plugin: PLUGIN, surface: 'terminal' }, BAND))];
                case 2:
                    ui = _b.sent();
                    _a = testing_1.expect;
                    return [4 /*yield*/, ui.find({ type: 'Text', text: /sin conexión/ })];
                case 3:
                    _a.apply(void 0, [_b.sent()]).toBeDefined();
                    return [4 /*yield*/, ui.unmount()];
                case 4:
                    _b.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, testing_1.test)('el menú muestra todo y resuelve una decisión', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var _a, calls, bodies, _i, _b, surface, ui_1, _c, _d, _e, ui;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    _a = world(on), calls = _a.calls, bodies = _a.bodies;
                    return [4 /*yield*/, start($)];
                case 1:
                    _f.sent();
                    _i = 0, _b = ['terminal', 'desktop'];
                    _f.label = 2;
                case 2:
                    if (!(_i < _b.length)) return [3 /*break*/, 9];
                    surface = _b[_i];
                    return [4 /*yield*/, $.ui.mount(__assign({ plugin: PLUGIN, surface: surface }, MENU))];
                case 3:
                    ui_1 = _f.sent();
                    _c = testing_1.expect;
                    return [4 /*yield*/, ui_1.find({ type: 'Text', text: /TE ESPERAN \(3\)/ })];
                case 4:
                    _c.apply(void 0, [_f.sent()]).toBeDefined();
                    _d = testing_1.expect;
                    return [4 /*yield*/, ui_1.find({ type: 'Text', text: /PARA TOMAR \(1\)/ })];
                case 5:
                    _d.apply(void 0, [_f.sent()]).toBeDefined();
                    _e = testing_1.expect;
                    return [4 /*yield*/, ui_1.find({ key: 'mn-b3-sky' })];
                case 6:
                    _e.apply(void 0, [_f.sent()]).toBeDefined();
                    return [4 /*yield*/, ui_1.unmount()];
                case 7:
                    _f.sent();
                    _f.label = 8;
                case 8:
                    _i++;
                    return [3 /*break*/, 2];
                case 9: return [4 /*yield*/, $.ui.mount(__assign({ plugin: PLUGIN, surface: 'terminal' }, MENU))];
                case 10:
                    ui = _f.sent();
                    return [4 /*yield*/, ui.press({ key: 'mn-b1-1' })];
                case 11:
                    _f.sent();
                    (0, testing_1.expect)(calls).toContain('POST https://dagyard.cofoundy-dev.workers.dev/api/projects/marketplace-reservas/blockers/b1/resolve');
                    (0, testing_1.expect)(JSON.parse(bodies[bodies.length - 1]).choice).toBe(1);
                    return [4 /*yield*/, ui.unmount()];
                case 12:
                    _f.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, testing_1.test)('Pedir cambios pide el comentario y lo manda', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var bodies, ui, sent;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    bodies = world(on).bodies;
                    return [4 /*yield*/, start($)];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, $.ui.mount(__assign({ plugin: PLUGIN, surface: 'terminal' }, MENU))];
                case 2:
                    ui = _a.sent();
                    return [4 /*yield*/, ui.press({ key: 'mn-b2-1' })];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, ui.input({ key: 'mn-b2-note', text: 'El botón de pagar más grande' })];
                case 4:
                    _a.sent();
                    sent = JSON.parse(bodies[bodies.length - 1]);
                    (0, testing_1.expect)(sent.choice).toBe(1);
                    (0, testing_1.expect)(sent.note).toBe('El botón de pagar más grande');
                    return [4 /*yield*/, ui.unmount()];
                case 5:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
});
(0, testing_1.describe)('en el celular (sin campo de texto)', function () {
    (0, testing_1.test)('Pedir cambios se manda sin nota en vez de romper el menú', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var bodies, ui, sent;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    bodies = world(on).bodies;
                    return [4 /*yield*/, start($)];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, $.ui.mount(__assign({ plugin: PLUGIN, surface: 'mobile' }, MENU))];
                case 2:
                    ui = _a.sent();
                    return [4 /*yield*/, ui.press({ key: 'mn-b2-1' })];
                case 3:
                    _a.sent();
                    sent = JSON.parse(bodies[bodies.length - 1]);
                    (0, testing_1.expect)(sent.choice).toBe(1);
                    (0, testing_1.expect)(sent.note).toBe('Desde Claude Code');
                    return [4 /*yield*/, ui.unmount()];
                case 4:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
});
(0, testing_1.describe)('el proyecto según el repo', function () {
    (0, testing_1.test)('lee el .dagyard.json más cercano subiendo desde el cwd, con su url', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var calls, ui;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    calls = world(on, { files: { '/repo/.dagyard.json': JSON.stringify({ project: 'dagyard', url: 'https://otro.example/' }) } }).calls;
                    return [4 /*yield*/, start($, '/repo/packages/mod')];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, $.ui.mount(__assign({ plugin: PLUGIN, surface: 'terminal' }, BAND))];
                case 2:
                    ui = _a.sent();
                    (0, testing_1.expect)(calls).toContain('GET https://otro.example/api/projects/dagyard');
                    return [4 /*yield*/, ui.unmount()];
                case 3:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, testing_1.test)('DAGYARD_PROJECT manda sobre el .dagyard.json', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var calls, ui;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    calls = world(on, { env: { DAGYARD_PROJECT: 'otro' } }).calls;
                    return [4 /*yield*/, start($)];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, $.ui.mount(__assign({ plugin: PLUGIN, surface: 'terminal' }, BAND))];
                case 2:
                    ui = _a.sent();
                    (0, testing_1.expect)(calls).toContain('GET https://dagyard.cofoundy-dev.workers.dev/api/projects/otro');
                    return [4 /*yield*/, ui.unmount()];
                case 3:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, testing_1.test)('sin proyecto calla: ni banda ni llamadas, y /dagyard dice cómo enlazarlo', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var calls, ui, _a, out;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    calls = world(on, { files: {} }).calls;
                    return [4 /*yield*/, start($, '/sin/enlace')];
                case 1:
                    _b.sent();
                    return [4 /*yield*/, $.ui.mount(__assign({ plugin: PLUGIN, surface: 'terminal' }, BAND))];
                case 2:
                    ui = _b.sent();
                    _a = testing_1.expect;
                    return [4 /*yield*/, ui.find({ type: 'Text', text: /dagyard/ })];
                case 3:
                    _a.apply(void 0, [_b.sent()]).toBeUndefined();
                    return [4 /*yield*/, ui.unmount()];
                case 4:
                    _b.sent();
                    return [4 /*yield*/, $.command.run({ command: 'dagyard', args: '' })];
                case 5:
                    out = _b.sent();
                    (0, testing_1.expect)(out.text).toMatch(/\.dagyard\.json/);
                    (0, testing_1.expect)(calls).toEqual([]);
                    return [2 /*return*/];
            }
        });
    }); });
});
(0, testing_1.describe)('el aviso', function () {
    (0, testing_1.test)('un bloqueante nuevo avisa en la siguiente vuelta (≤20 s); los que ya estaban, no', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var snap, _a, toasts, clock;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    snap = JSON.parse(JSON.stringify(SNAP));
                    _a = world(on, { snap: function () { return snap; } }), toasts = _a.toasts, clock = _a.clock;
                    return [4 /*yield*/, start($)];
                case 1:
                    _b.sent();
                    return [4 /*yield*/, clock.settle()];
                case 2:
                    _b.sent();
                    (0, testing_1.expect)(toasts).toEqual([]);
                    snap.blockers.push({ id: 'b4', nodeId: 'comision', kind: 'decision', question: '¿Lanzamos el lunes?', options: ['Sí', 'No'], accessLabel: null, status: 'open' });
                    return [4 /*yield*/, clock.advance(10000)];
                case 3:
                    _b.sent();
                    (0, testing_1.expect)(toasts.length).toBe(1);
                    (0, testing_1.expect)(toasts[0]).toMatch(/Modelo de comisiones/);
                    (0, testing_1.expect)(toasts[0]).toMatch(/¿Lanzamos el lunes\?/);
                    return [4 /*yield*/, clock.advance(10000)];
                case 4:
                    _b.sent();
                    (0, testing_1.expect)(toasts.length).toBe(1);
                    return [2 /*return*/];
            }
        });
    }); });
});
(0, testing_1.describe)('durante un deploy', function () {
    var NODE = 'https://dagyard.cofoundy-dev.workers.dev/api/projects/marketplace-reservas/nodes/landing';
    var fail = function (status, code) { return ({ status: status, ok: false, headers: {}, text: JSON.stringify({ error: { code: code, message: code } }) }); };
    var OK = { status: 200, ok: true, headers: {}, text: JSON.stringify({ id: 'landing' }) };
    /** responde cada PATCH al nodo con lo que toca en la lista, en orden; después, 200 */
    function patches() {
        var answers = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            answers[_i] = arguments[_i];
        }
        return function (method, url) { var _a; return (method === 'PATCH' && url === NODE ? (_a = answers.shift()) !== null && _a !== void 0 ? _a : OK : undefined); };
    }
    function takeLanding($) {
        return __awaiter(this, void 0, void 0, function () {
            var ui, i;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, start($)];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, $.ui.mount(__assign({ plugin: PLUGIN, surface: 'terminal' }, BAND))];
                    case 2:
                        ui = _a.sent();
                        i = 0;
                        _a.label = 3;
                    case 3:
                        if (!(i < 3)) return [3 /*break*/, 6];
                        return [4 /*yield*/, ui.press({ key: 'dy-next' })];
                    case 4:
                        _a.sent();
                        _a.label = 5;
                    case 5:
                        i++;
                        return [3 /*break*/, 3];
                    case 6: return [4 /*yield*/, ui.press({ key: 'dy-take' })];
                    case 7:
                        _a.sent();
                        return [2 /*return*/, ui];
                }
            });
        });
    }
    (0, testing_1.test)('un PATCH que recibe 503 y luego 200 termina bien, con la misma clave en ambos intentos', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var _a, calls, keys, sent, toasts, clock, ui;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = world(on, { respond: patches(fail(503, 'unavailable')) }), calls = _a.calls, keys = _a.keys, sent = _a.sent, toasts = _a.toasts, clock = _a.clock;
                    return [4 /*yield*/, takeLanding($)];
                case 1:
                    ui = _b.sent();
                    return [4 /*yield*/, clock.advance(2000)];
                case 2:
                    _b.sent();
                    (0, testing_1.expect)(calls.filter(function (c) { return c === "PATCH ".concat(NODE); }).length).toBe(2);
                    (0, testing_1.expect)(keys.length).toBe(2);
                    (0, testing_1.expect)(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
                    (0, testing_1.expect)(keys[1]).toBe(keys[0]);
                    (0, testing_1.expect)(sent).toContain('/goal Arma la página de lanzamiento');
                    (0, testing_1.expect)(toasts.some(function (t) { return /no respondió/.test(t); })).toBe(false);
                    return [4 /*yield*/, ui.unmount()];
                case 3:
                    _b.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, testing_1.test)('un corte de red también se reintenta con la misma clave', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var _a, keys, sent, clock, ui;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = world(on, { respond: patches('cut') }), keys = _a.keys, sent = _a.sent, clock = _a.clock;
                    return [4 /*yield*/, takeLanding($)];
                case 1:
                    ui = _b.sent();
                    return [4 /*yield*/, clock.advance(2000)];
                case 2:
                    _b.sent();
                    (0, testing_1.expect)(keys.length).toBe(2);
                    (0, testing_1.expect)(keys[1]).toBe(keys[0]);
                    (0, testing_1.expect)(sent).toContain('/goal Arma la página de lanzamiento');
                    return [4 /*yield*/, ui.unmount()];
                case 3:
                    _b.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, testing_1.test)('cada invocación lleva su propia clave', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var _a, keys, clock, ui;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = world(on), keys = _a.keys, clock = _a.clock;
                    return [4 /*yield*/, takeLanding($)];
                case 1:
                    ui = _b.sent();
                    return [4 /*yield*/, clock.settle()];
                case 2:
                    _b.sent();
                    return [4 /*yield*/, ui.press({ key: 'dy-take' })]; // el snapshot la sigue dando pendiente: se toma otra vez
                case 3:
                    _b.sent(); // el snapshot la sigue dando pendiente: se toma otra vez
                    return [4 /*yield*/, clock.settle()];
                case 4:
                    _b.sent();
                    (0, testing_1.expect)(keys.length).toBe(2);
                    (0, testing_1.expect)(keys[1]).not.toBe(keys[0]);
                    return [4 /*yield*/, ui.unmount()];
                case 5:
                    _b.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, testing_1.test)('overloaded no se repite: reintentar empeora', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var _a, calls, sent, toasts, clock, ui;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = world(on, { respond: patches(fail(503, 'overloaded')) }), calls = _a.calls, sent = _a.sent, toasts = _a.toasts, clock = _a.clock;
                    return [4 /*yield*/, takeLanding($)];
                case 1:
                    ui = _b.sent();
                    return [4 /*yield*/, clock.advance(2000)];
                case 2:
                    _b.sent();
                    (0, testing_1.expect)(calls.filter(function (c) { return c === "PATCH ".concat(NODE); }).length).toBe(1);
                    (0, testing_1.expect)(sent).toEqual([]);
                    (0, testing_1.expect)(toasts.some(function (t) { return /no respondió \(503\)/.test(t); })).toBe(true);
                    return [4 /*yield*/, ui.unmount()];
                case 3:
                    _b.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, testing_1.test)('se rinde tras tres intentos', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
        var u, _a, calls, sent, clock, ui;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    u = fail(503, 'unavailable');
                    _a = world(on, { respond: patches(u, u, u, u) }), calls = _a.calls, sent = _a.sent, clock = _a.clock;
                    return [4 /*yield*/, takeLanding($)];
                case 1:
                    ui = _b.sent();
                    return [4 /*yield*/, clock.advance(5000)];
                case 2:
                    _b.sent();
                    (0, testing_1.expect)(calls.filter(function (c) { return c === "PATCH ".concat(NODE); }).length).toBe(3);
                    (0, testing_1.expect)(sent).toEqual([]);
                    return [4 /*yield*/, ui.unmount()];
                case 3:
                    _b.sent();
                    return [2 /*return*/];
            }
        });
    }); });
});
