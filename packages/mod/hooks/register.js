"use strict";
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = void 0;
var view_1 = require("./view");
var URL_DEFAULT = 'https://dagyard.cofoundy-dev.workers.dev';
var LINK_FILE = '.dagyard.json';
var POLL_MS = 10000; // un bloqueante nuevo avisa en ≤20 s aun con la red lenta
var TEAM = 'Claude Code';
var MENU = 'dagyard-menu';
var AMBER = '#ffb547';
var BLUE = '#9fd3ff';
var MUTED = '#6b7a93';
var base = URL_DEFAULT;
var project = null;
var seen = null; // los bloqueantes abiertos ya vistos; null hasta la primera carga
var view = null;
var cursor = 0;
var working = null;
var hidden = false;
var busy = false;
var lastError = '';
var loading = false;
var commenting = null; // la revisión a la que se le está escribiendo «qué cambiarías»
function home($) {
    return __awaiter(this, void 0, void 0, function () {
        var fromEnv, out;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, $.env.get('HOME')];
                case 1:
                    fromEnv = _c.sent();
                    if (fromEnv)
                        return [2 /*return*/, fromEnv];
                    return [4 /*yield*/, $.process.run(['printenv', 'HOME']).catch(function () { return null; })];
                case 2:
                    out = _c.sent();
                    return [2 /*return*/, (_b = (_a = out === null || out === void 0 ? void 0 : out.stdout) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : ''];
            }
        });
    });
}
function key($, file) {
    return __awaiter(this, void 0, void 0, function () {
        var dir, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, home($)];
                case 1:
                    dir = _b.sent();
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, $.fs.read("".concat(dir, "/.config/dagyard/").concat(file))];
                case 3: return [2 /*return*/, (_b.sent()).trim() || null];
                case 4:
                    _a = _b.sent();
                    return [2 /*return*/, null];
                case 5: return [2 /*return*/];
            }
        });
    });
}
/** El .dagyard.json más cercano subiendo desde `cwd` (el que escribe el repo, como el CLI). */
function linkOf($, cwd) {
    return __awaiter(this, void 0, void 0, function () {
        var dir, raw, _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    dir = cwd.replace(/\/+$/, '');
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    _b = (_a = JSON).parse;
                    return [4 /*yield*/, $.fs.read("".concat(dir || '', "/").concat(LINK_FILE))];
                case 2:
                    raw = _b.apply(_a, [_d.sent()]);
                    return [2 /*return*/, {
                            project: typeof (raw === null || raw === void 0 ? void 0 : raw.project) === 'string' ? raw.project.trim() || undefined : undefined,
                            url: typeof (raw === null || raw === void 0 ? void 0 : raw.url) === 'string' ? raw.url.trim() || undefined : undefined,
                        }];
                case 3:
                    _c = _d.sent();
                    return [3 /*break*/, 4];
                case 4:
                    if (!dir)
                        return [2 /*return*/, {}];
                    dir = dir.slice(0, dir.lastIndexOf('/'));
                    _d.label = 5;
                case 5: return [3 /*break*/, 1];
                case 6: return [2 /*return*/];
            }
        });
    });
}
/** Avisa lo que te espera y no estaba la vez anterior; la primera carga solo toma nota. */
function notice($, v) {
    var open = new Set(v.waiting.map(function (it) { return (it.kind === 'waiting' ? it.blocker.id : ''); }));
    var fresh = seen ? v.waiting.filter(function (it) { return it.kind === 'waiting' && !seen.has(it.blocker.id); }) : [];
    seen = open;
    var first = fresh[0];
    if (fresh.length === 1 && (first === null || first === void 0 ? void 0 : first.kind) === 'waiting') {
        var node = first.node, b = first.blocker;
        var what = b.kind === 'decision' ? 'tu decisión' : b.kind === 'review' ? 'tu revisión' : 'un acceso';
        $.ui.toast("\u00AB".concat(node.title, "\u00BB espera ").concat(what, ": ").concat(b.question));
    }
    else if (fresh.length > 1) {
        $.ui.toast("".concat(fresh.length, " cosas nuevas te esperan \u00B7 /dagyard"));
    }
}
/**
 * Esperas base entre intentos ante un `503 unavailable` o un corte de red (≈1,2 s: lo que dura el corte de
 * un deploy), con jitter de ×0,5 a ×1,5. Las mismas que `packages/cli/src/api.ts` (el mod no lo importa:
 * corre con `$.http.fetch`, no se empaqueta).
 */
var RETRY_DELAYS_MS = [300, 900];
var jitter = function (ms) { return Math.round(ms * (0.5 + Math.random())); };
/**
 * ¿Repetir es seguro y útil? Un corte de red o un `503` del Worker que no escribió (`unavailable`) o que no
 * llegó al Worker (sin cuerpo de error). `overloaded` (reintentar empeora) y `uncertain` (la escritura pudo
 * quedar sin su clave) no se repiten.
 */
function transient(res) {
    var _a, _b;
    if (!res)
        return true;
    if (res.status !== 503)
        return false;
    try {
        var code = (_b = (_a = JSON.parse(res.text)) === null || _a === void 0 ? void 0 : _a.error) === null || _b === void 0 ? void 0 : _b.code;
        return !code || code === 'unavailable';
    }
    catch (_c) {
        return true;
    }
}
/**
 * Una invocación de la API. Toda escritura lleva una `Idempotency-Key` nueva, la misma en cada reintento:
 * así reintentar un `503 unavailable` o un corte de red (la escritura pudo quedar) nunca la duplica.
 */
function api($, path, method, body, owner) {
    return __awaiter(this, void 0, void 0, function () {
        var token, headers, init, attempt, res, cut, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, key($, owner ? 'owner-token' : 'agent-key')];
                case 1:
                    token = _a.sent();
                    if (!token)
                        throw new Error('falta la clave en ~/.config/dagyard');
                    headers = { authorization: "Bearer ".concat(token), 'user-agent': 'dagyard-mod/0.2' };
                    if (body !== undefined)
                        headers['content-type'] = 'application/json';
                    if (method !== 'GET' && method !== 'HEAD')
                        headers['idempotency-key'] = crypto.randomUUID();
                    init = { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) };
                    attempt = 0;
                    _a.label = 2;
                case 2:
                    res = null;
                    cut = null;
                    _a.label = 3;
                case 3:
                    _a.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, $.http.fetch("".concat(base).concat(path), init)];
                case 4:
                    res = _a.sent();
                    return [3 /*break*/, 6];
                case 5:
                    err_1 = _a.sent();
                    cut = err_1;
                    return [3 /*break*/, 6];
                case 6:
                    if (res === null || res === void 0 ? void 0 : res.ok)
                        return [2 /*return*/, res.text ? JSON.parse(res.text) : null];
                    if (!transient(res) || attempt >= RETRY_DELAYS_MS.length) {
                        if (res)
                            throw new Error(String(res.status));
                        throw cut instanceof Error ? cut : new Error(String(cut));
                    }
                    return [4 /*yield*/, $.clock.sleep(jitter(RETRY_DELAYS_MS[attempt]))];
                case 7:
                    _a.sent();
                    _a.label = 8;
                case 8:
                    attempt++;
                    return [3 /*break*/, 2];
                case 9: return [2 /*return*/];
            }
        });
    });
}
function refresh($) {
    return __awaiter(this, void 0, void 0, function () {
        var snap, w_1, err_2;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (!project)
                        return [2 /*return*/];
                    loading = true;
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, api($, "/api/projects/".concat(project), 'GET', undefined, false)];
                case 2:
                    snap = (_c.sent());
                    view = (0, view_1.viewOf)(snap);
                    notice($, view);
                    w_1 = working;
                    if (w_1)
                        working = (_a = snap.nodes.find(function (n) { return n.id === w_1.id && n.status === 'working'; })) !== null && _a !== void 0 ? _a : null;
                    lastError = '';
                    return [3 /*break*/, 4];
                case 3:
                    err_2 = _c.sent();
                    view = null;
                    lastError = (_b = err_2 === null || err_2 === void 0 ? void 0 : err_2.message) !== null && _b !== void 0 ? _b : String(err_2);
                    return [3 /*break*/, 4];
                case 4:
                    loading = false;
                    $.ui.invalidate('ui.render');
                    return [2 /*return*/];
            }
        });
    });
}
function settle($, err) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (err)
                        $.ui.toast("Dagyard no respondi\u00F3 (".concat(err.message, ")"));
                    busy = false;
                    return [4 /*yield*/, refresh($)];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function resolve($, it, choice, note) {
    return __awaiter(this, void 0, void 0, function () {
        var err, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (busy)
                        return [2 /*return*/];
                    busy = true;
                    $.ui.invalidate('ui.render');
                    err = null;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, api($, "/api/projects/".concat(project, "/blockers/").concat(it.blocker.id, "/resolve"), 'POST', { choice: choice, note: note || 'Desde Claude Code' }, true)];
                case 2:
                    _a.sent();
                    commenting = null;
                    $.ui.toast("\u00AB".concat(it.node.title, "\u00BB: ").concat(it.blocker.options[choice], ". El equipo sigue."));
                    return [3 /*break*/, 4];
                case 3:
                    e_1 = _a.sent();
                    err = e_1;
                    return [3 /*break*/, 4];
                case 4: return [4 /*yield*/, settle($, err)];
                case 5:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function take($, node) {
    return __awaiter(this, void 0, void 0, function () {
        var err, e_2;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (busy)
                        return [2 /*return*/];
                    busy = true;
                    $.ui.invalidate('ui.render');
                    err = null;
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, api($, "/api/projects/".concat(project, "/nodes/").concat(node.id), 'PATCH', { status: 'working', team: TEAM, progress: 0.05 }, false)];
                case 2:
                    _b.sent();
                    working = node;
                    $.ui.toast("Tomaste \u00AB".concat(node.title, "\u00BB. Ya brilla en azul en el cielo."));
                    return [3 /*break*/, 4];
                case 3:
                    e_2 = _b.sent();
                    err = e_2;
                    return [3 /*break*/, 4];
                case 4: return [4 /*yield*/, settle($, err)];
                case 5:
                    _b.sent();
                    if (!!err) return [3 /*break*/, 7];
                    return [4 /*yield*/, $.command.run({ command: 'goal', args: (_a = node.goal) !== null && _a !== void 0 ? _a : "Termina \u00AB".concat(node.title, "\u00BB") })];
                case 6:
                    _b.sent();
                    _b.label = 7;
                case 7: return [2 /*return*/];
            }
        });
    });
}
function patchWorking($, node, body, toast) {
    return __awaiter(this, void 0, void 0, function () {
        var err, e_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (busy)
                        return [2 /*return*/];
                    busy = true;
                    $.ui.invalidate('ui.render');
                    err = null;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, api($, "/api/projects/".concat(project, "/nodes/").concat(node.id), 'PATCH', body, false)];
                case 2:
                    _a.sent();
                    working = null;
                    if (toast)
                        $.ui.toast(toast);
                    return [3 /*break*/, 4];
                case 3:
                    e_3 = _a.sent();
                    err = e_3;
                    return [3 /*break*/, 4];
                case 4: return [4 /*yield*/, settle($, err)];
                case 5:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function openSky($) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, $.process.run(['open', base]).catch(function () { return undefined; })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// Primero abre y después carga: el motor coloca el panel a cualquier ancho solo si el clic de la
// persona está detrás; una espera de red antes del open lo vuelve «no pedido» (y bajo 144 columnas espera).
function openMenu($) {
    return __awaiter(this, void 0, void 0, function () {
        var opened;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, $.ui.open({ id: MENU, title: 'Dagyard', focus: true, closeOnEscape: true })];
                case 1:
                    opened = _a.sent();
                    if (!opened.isPlaced)
                        $.ui.toast("Dagyard: el men\u00FA no cabe aqu\u00ED (".concat(opened.reason, ")"));
                    void refresh($);
                    return [2 /*return*/];
            }
        });
    });
}
function comment($, blockerId) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            commenting = blockerId;
            $.ui.invalidate('ui.render');
            return [2 /*return*/];
        });
    });
}
function toggleBand($) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            hidden = !hidden;
            $.ui.invalidate('ui.render');
            return [2 /*return*/];
        });
    });
}
function skip($) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            cursor += 1;
            $.ui.invalidate('ui.render');
            return [2 /*return*/];
        });
    });
}
var register = function (on) {
    on('session.start', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var link, _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, linkOf($, e.cwd)];
                case 1:
                    link = _c.sent();
                    return [4 /*yield*/, $.env.get('DAGYARD_URL')];
                case 2:
                    _a = (_c.sent()) || link.url;
                    if (_a) return [3 /*break*/, 4];
                    return [4 /*yield*/, key($, 'url')];
                case 3:
                    _a = (_c.sent());
                    _c.label = 4;
                case 4:
                    base = (_a || URL_DEFAULT).replace(/\/+$/, '');
                    return [4 /*yield*/, $.env.get('DAGYARD_PROJECT')];
                case 5:
                    _b = (_c.sent()) || link.project;
                    if (_b) return [3 /*break*/, 7];
                    return [4 /*yield*/, key($, 'project')];
                case 6:
                    _b = (_c.sent());
                    _c.label = 7;
                case 7:
                    project = _b || null;
                    view = null;
                    seen = null;
                    return [4 /*yield*/, $.command.register({ name: 'dagyard', description: 'Abre el menú de Dagyard: todo lo que te espera y lo que está para tomar' })];
                case 8:
                    _c.sent();
                    if (project) {
                        $.clock.every(POLL_MS, function () { return void refresh($); });
                        void refresh($);
                    }
                    return [2 /*return*/, next(e)];
            }
        });
    }); });
    on('command.run', { command: 'dagyard' }, function ($) { return __awaiter(void 0, void 0, void 0, function () {
        var v;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!project)
                        return [2 /*return*/, {
                                text: "Este repo no est\u00E1 enlazado a un proyecto de Dagyard. Agrega ".concat(LINK_FILE, " en su ra\u00EDz con {\"project\": \"<id>\"} (o DAGYARD_PROJECT) y abre otra sesi\u00F3n."),
                            }];
                    return [4 /*yield*/, openMenu($)];
                case 1:
                    _a.sent();
                    v = view;
                    return [2 /*return*/, {
                            text: v
                                ? "".concat(v.project, ": ").concat(v.waiting.length, " te esperan, ").concat(v.startable.length, " para tomar.")
                                : "Dagyard no respondi\u00F3 (".concat(lastError || 'sin detalle', ") \u00B7 ").concat(base, "/api/projects/").concat(project),
                        }];
            }
        });
    }); });
    on('turn.complete', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var done;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, next(e)];
                case 1:
                    done = _a.sent();
                    return [4 /*yield*/, refresh($)];
                case 2:
                    _a.sent();
                    return [2 /*return*/, done];
            }
        });
    }); });
    on('ui.render', { component: 'AbovePrompt' }, function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var below, v, _a, B, T, _b, Box, Button, Text, list, head, body, w, i, it_1, more, b, label, buttons, n_1;
        var _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, next(e)];
                case 1:
                    below = _d.sent();
                    v = view;
                    if (!project || e.props.hasSurvey || e.props.isWorking || hidden)
                        return [2 /*return*/, below];
                    if (!v) {
                        if (!loading && !lastError)
                            void refresh($);
                        _a = $.ui.resolve(e), B = _a.Box, T = _a.Text;
                        return [2 /*return*/, (<B flexDirection="column">
          <T color={MUTED}>◆ dagyard · sin conexión con {base} ({lastError || 'cargando…'}) · /dagyard reintenta</T>
          {below}
        </B>)];
                    }
                    _b = $.ui.resolve(e), Box = _b.Box, Button = _b.Button, Text = _b.Text;
                    list = __spreadArray(__spreadArray([], v.waiting, true), v.startable, true);
                    head = (<Text wrap="truncate-end">
        <Text color={BLUE}>◆ dagyard </Text>
        <Text bold>{v.project}</Text>
        <Text color={MUTED}> · {v.done} de {v.total} listas{v.now ? " \u00B7 ahora en ".concat(v.now) : ''} · </Text>
        <Text color={v.waiting.length ? AMBER : MUTED}>{v.waiting.length} te esperan</Text>
        <Text color={MUTED}> · </Text>
        <Text color={v.startable.length ? BLUE : MUTED}>{v.startable.length} para tomar</Text>
      </Text>);
                    body = null;
                    w = working;
                    if (busy) {
                        body = <Text color={MUTED}>…</Text>;
                    }
                    else if (w) {
                        body = (<Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={BLUE}>Trabajando en </Text>
            <Text bold>{w.title}</Text>
          </Text>
          <Box flexWrap="wrap">
            <Button key="dy-done" label="Hecha" hotkey="h" variant="primary" onPress={function () { return void patchWorking($, w, { status: 'done' }, "\u00AB".concat(w.title, "\u00BB est\u00E1 lista.")); }}/>
            <Button key="dy-release" label="Soltarla" hotkey="l" onPress={function () { return void patchWorking($, w, { status: 'pending', team: null, progress: 0 }, ''); }}/>
            <Button key="dy-open" label="Ver el cielo" hotkey="o" dimColor onPress={function () { return void openSky($); }}/>
          </Box>
        </Box>);
                    }
                    else if (list.length > 0) {
                        i = cursor % list.length;
                        it_1 = list[i];
                        more = list.length > 1 ? (<Button key="dy-next" label={"Otra (".concat(i + 1, "/").concat(list.length, ")")} hotkey="s" dimColor onPress={function () { return void skip($); }}/>) : null;
                        if (it_1.kind === 'waiting') {
                            b = it_1.blocker;
                            label = b.kind === 'decision' ? 'Te espera tu decisión' : b.kind === 'review' ? 'Te espera tu revisión' : 'Te espera un acceso';
                            buttons = b.kind === 'access'
                                ? [<Button key="dy-sky" label="Darlo en el cielo" hotkey="o" variant="primary" onPress={function () { return void openSky($); }}/>]
                                : b.options.slice(0, 3).map(function (opt, k) { return (<Button key={"dy-opt-".concat(k)} label={opt} hotkey={String(k + 1)} variant={k === 0 ? 'primary' : undefined} onPress={function () { return void resolve($, it_1, k, ''); }}/>); });
                            body = (<Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={AMBER}>{label} · </Text>
              <Text bold>{it_1.node.title}</Text>
              <Text color={MUTED}> — {b.kind === 'access' ? (_c = b.accessLabel) !== null && _c !== void 0 ? _c : b.question : b.question}</Text>
            </Text>
            <Box flexWrap="wrap">
              {buttons}
              {more}
              <Button key="dy-menu" label="Ver todo" hotkey="m" dimColor onPress={function () { return void openMenu($); }}/>
            </Box>
          </Box>);
                        }
                        else {
                            n_1 = it_1.node;
                            body = (<Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={BLUE}>Para tomar · </Text>
              <Text bold>{n_1.title}</Text>
              {n_1.goal ? <Text color={MUTED}> — /goal {n_1.goal}</Text> : null}
            </Text>
            <Box flexWrap="wrap">
              <Button key="dy-take" label="Trabajar en esto" hotkey="t" variant="primary" onPress={function () { return void take($, n_1); }}/>
              {more}
              <Button key="dy-menu" label="Ver todo" hotkey="m" dimColor onPress={function () { return void openMenu($); }}/>
            </Box>
          </Box>);
                        }
                    }
                    return [2 /*return*/, (<Box flexDirection="column">
        {head}
        {body}
        {below}
      </Box>)];
            }
        });
    }); });
    on('ui.render', { component: 'Pane', requestId: MENU }, function ($, e) { return __awaiter(void 0, void 0, void 0, function () {
        var els, Box, Button, Text, Input, v, w, rows;
        return __generator(this, function (_a) {
            els = $.ui.resolve(e);
            Box = els.Box, Button = els.Button, Text = els.Text;
            Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : null;
            v = view;
            if (!v) {
                return [2 /*return*/, (<Box flexDirection="column">
          <Text color={MUTED}>Sin conexión con {base} ({lastError || 'cargando…'}).</Text>
          <Button key="mn-retry" label="Reintentar" onPress={function () { return void refresh($); }}/>
        </Box>)];
            }
            w = working;
            rows = [];
            rows.push(<Text key="mn-head" wrap="truncate-end">
        <Text bold>{v.project}</Text>
        <Text color={MUTED}> · {v.done} de {v.total} listas{v.now ? " \u00B7 ahora en ".concat(v.now) : ''}</Text>
      </Text>);
            if (w) {
                rows.push(<Text key="mn-w-sec" color={BLUE}>{'\n'}TRABAJANDO</Text>);
                rows.push(<Box key="mn-w" flexDirection="column">
          <Text bold>{w.title}</Text>
          <Box flexWrap="wrap">
            <Button key="mn-w-done" label="Hecha" variant="primary" onPress={function () { return void patchWorking($, w, { status: 'done' }, "\u00AB".concat(w.title, "\u00BB est\u00E1 lista.")); }}/>
            <Button key="mn-w-release" label="Soltarla" onPress={function () { return void patchWorking($, w, { status: 'pending', team: null, progress: 0 }, ''); }}/>
          </Box>
        </Box>);
            }
            rows.push(<Text key="mn-wait-sec" color={v.waiting.length ? AMBER : MUTED}>{'\n'}TE ESPERAN ({v.waiting.length})</Text>);
            if (v.waiting.length === 0)
                rows.push(<Text key="mn-wait-none" color={MUTED}>Nada te espera.</Text>);
            v.waiting.forEach(function (it) {
                var _a;
                if (it.kind !== 'waiting')
                    return;
                var b = it.blocker;
                var kind = b.kind === 'decision' ? 'Decisión' : b.kind === 'review' ? 'Revisión' : 'Acceso';
                var id = b.id;
                var actions;
                if (b.kind === 'access') {
                    actions = <Button key={"mn-".concat(id, "-sky")} label="Darlo en el cielo" variant="primary" onPress={function () { return void openSky($); }}/>;
                }
                else if (commenting === id && Input) {
                    var k_1 = b.options.findIndex(function (o) { return /cambio/i.test(o); });
                    actions = (<Box flexDirection="column">
            <Input key={"mn-".concat(id, "-note")} label="Qué cambiarías: " placeholder="en una línea" submitLabel="enviar" autoFocus onSubmit={function (value) { return void resolve($, it, k_1 < 0 ? b.options.length - 1 : k_1, value); }}/>
            <Button key={"mn-".concat(id, "-cancel")} label="Cancelar" dimColor onPress={function () { return void comment($, null); }}/>
          </Box>);
                }
                else {
                    actions = (<Box flexWrap="wrap">
            {b.options.map(function (opt, k) {
                            return b.kind === 'review' && Input && /cambio/i.test(opt) ? (<Button key={"mn-".concat(id, "-").concat(k)} label={opt} onPress={function () { return void comment($, id); }}/>) : (<Button key={"mn-".concat(id, "-").concat(k)} label={opt} variant={k === 0 ? 'primary' : undefined} onPress={function () { return void resolve($, it, k, ''); }}/>);
                        })}
          </Box>);
                }
                rows.push(<Box key={"mn-".concat(id)} flexDirection="column">
          <Text wrap="wrap">
            <Text color={AMBER}>{kind} · </Text>
            <Text bold>{it.node.title}</Text>
          </Text>
          <Text wrap="wrap" color={MUTED}>{b.kind === 'access' ? "".concat(b.question, " (").concat((_a = b.accessLabel) !== null && _a !== void 0 ? _a : 'acceso', ")") : b.question}</Text>
          {actions}
        </Box>);
            });
            rows.push(<Text key="mn-take-sec" color={v.startable.length ? BLUE : MUTED}>{'\n'}PARA TOMAR ({v.startable.length})</Text>);
            if (v.startable.length === 0)
                rows.push(<Text key="mn-take-none" color={MUTED}>Nada desbloqueado sin tomar.</Text>);
            v.startable.forEach(function (it) {
                var n = it.node;
                rows.push(<Box key={"mn-t-".concat(n.id)} flexDirection="column">
          <Text bold>{n.title}</Text>
          {n.goal ? <Text wrap="wrap" color={MUTED}>/goal {n.goal}</Text> : null}
          <Button key={"mn-t-".concat(n.id, "-take")} label="Trabajar en esto" variant="primary" onPress={function () { return void take($, n); }}/>
        </Box>);
            });
            rows.push(<Box key="mn-foot">
        <Text>{'\n'}</Text>
        <Button key="mn-sky" label="Ver el cielo" dimColor onPress={function () { return void openSky($); }}/>
        <Button key="mn-band" label={hidden ? 'Mostrar la banda' : 'Ocultar la banda'} dimColor onPress={function () { return void toggleBand($); }}/>
      </Box>);
            return [2 /*return*/, <Box flexDirection="column">{rows}</Box>];
        });
    }); });
};
exports.register = register;
