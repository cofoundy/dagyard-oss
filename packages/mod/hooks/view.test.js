"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var testing_1 = require("claude-code/testing");
var view_1 = require("./view");
var node = function (id, status, team) {
    if (team === void 0) { team = null; }
    return ({
        id: id,
        title: "Tarea ".concat(id),
        stage: id.startsWith('d') ? 'diseno' : 'construccion',
        status: status,
        team: team,
        goal: "Haz ".concat(id),
    });
};
var snap = {
    project: { id: 'p', name: 'Marketplace', stages: [{ id: 'diseno', name: 'Diseño' }, { id: 'construccion', name: 'Construcción' }] },
    nodes: [
        node('d1', 'done', 'Diseño'),
        node('d2', 'blocked', 'Diseño'),
        node('c1', 'pending'), // depende de d1 (listo) → para tomar
        node('c2', 'pending'), // depende de d2 (bloqueado) → no
        node('c3', 'pending', 'Construcción'), // ya tiene equipo → no
        node('c4', 'working', 'Construcción'),
    ],
    edges: [
        { from: 'd1', to: 'c1' },
        { from: 'd2', to: 'c2' },
    ],
    blockers: [
        { id: 'b1', nodeId: 'd2', kind: 'decision', question: '¿A o B?', options: ['A', 'B'], accessLabel: null, status: 'open' },
        { id: 'b2', nodeId: 'd1', kind: 'review', question: 'Revisa', options: ['Aprobar'], accessLabel: null, status: 'resolved' },
    ],
};
(0, testing_1.test)('te esperan: solo los bloqueantes abiertos', function () {
    var v = (0, view_1.viewOf)(snap);
    (0, testing_1.expect)(v.waiting.map(function (i) { return (i.kind === 'waiting' ? i.blocker.id : ''); })).toEqual(['b1']);
});
(0, testing_1.test)('para tomar: pendiente, sin equipo y con sus dependencias listas', function () {
    var v = (0, view_1.viewOf)(snap);
    (0, testing_1.expect)(v.startable.map(function (i) { return i.node.id; })).toEqual(['c1']);
});
(0, testing_1.test)('cabecera: listas y etapas vivas', function () {
    var v = (0, view_1.viewOf)(snap);
    (0, testing_1.expect)(v.done).toBe(1);
    (0, testing_1.expect)(v.total).toBe(6);
    (0, testing_1.expect)(v.now).toBe('Diseño · Construcción');
});
