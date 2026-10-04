"use strict";
// La vista de la banda, calculada desde el snapshot del proyecto. Pura, para poder probarla.
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
exports.viewOf = viewOf;
function viewOf(s) {
    var _a;
    var byId = new Map(s.nodes.map(function (n) { return [n.id, n]; }));
    var deps = new Map();
    for (var _i = 0, _b = s.edges; _i < _b.length; _i++) {
        var e = _b[_i];
        deps.set(e.to, __spreadArray(__spreadArray([], ((_a = deps.get(e.to)) !== null && _a !== void 0 ? _a : []), true), [e.from], false));
    }
    var waiting = [];
    for (var _c = 0, _d = s.blockers; _c < _d.length; _c++) {
        var b = _d[_c];
        var node = byId.get(b.nodeId);
        if (b.status === 'open' && node)
            waiting.push({ kind: 'waiting', blocker: b, node: node });
    }
    // Para tomar: pendiente, nadie la tomó y todo lo que necesita ya está listo.
    var startable = s.nodes
        .filter(function (n) { return n.status === 'pending' && !n.team; })
        .filter(function (n) { var _a; return ((_a = deps.get(n.id)) !== null && _a !== void 0 ? _a : []).every(function (d) { var _a; return ((_a = byId.get(d)) === null || _a === void 0 ? void 0 : _a.status) === 'done'; }); })
        .map(function (n) { return ({ kind: 'startable', node: n }); });
    var live = s.project.stages.filter(function (st) {
        return s.nodes.some(function (n) { return n.stage === st.id && (n.status === 'working' || n.status === 'blocked'); });
    });
    return {
        project: s.project.name,
        now: live.map(function (st) { return st.name; }).join(' · '),
        done: s.nodes.filter(function (n) { return n.status === 'done'; }).length,
        total: s.nodes.length,
        waiting: waiting,
        startable: startable,
    };
}
