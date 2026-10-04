// El catálogo de todo lo que lee el PM, en inglés y en español (#73).
// `en` define las claves; `es` tiene que tener exactamente las mismas: si falta o sobra una, `tsc` falla.
// Un valor es un texto con `{variables}` o, si depende de una cantidad, sus formas plurales
// (las elige Intl.PluralRules con `count`; `zero` es opcional y gana cuando count === 0).
// en: inglés natural para PMs, sin jerga; glosario fijo compartido con el CLI y el mod (estados, bloqueantes,
// lema de la entrada). es: español peruano, tuteo, nunca voseo. «Dagyard» no se traduce.

export type Plural = { zero?: string; one?: string; other: string };
export type Message = string | Plural;

export const en = {
  'lang.name': 'English',
  'lang.switch': 'Language',
  'time.justNow': 'just now',

  // estados de una tarea
  'status.done': 'Done',
  'status.working': 'In progress',
  'status.blocked': 'Needs you',
  'status.pending': 'Pending',

  // lo que te pide una tarea
  'block.decision': 'Needs your decision',
  'block.review': 'Needs your review',
  'block.access': 'Needs an access',
  'blockToast.decision': 'needs your decision',
  'blockToast.review': 'needs your review',
  'blockToast.access': 'needs an access',

  // cuentas
  'count.done': { zero: 'No tasks', other: '{done} of {total} done' },
  'count.waiting': { zero: 'Nothing needs you', one: '{count} needs you', other: '{count} need you' },
  'team.name': '{team} team',

  // entrada
  'entry.title': 'Your factory, in one sky',
  'entry.lead': 'Paste your access key to see your projects.',
  'entry.label': 'Access key',
  'entry.placeholder': 'Paste your key',
  'entry.cta': 'Sign in',
  'entry.checking': 'Signing in…',
  'entry.bad': "That key doesn't work. Check that you copied all of it.",
  'entry.empty': 'The key is missing.',
  'entry.expired': 'Your session expired. Paste your key again.',
  'entry.offline': "Couldn't connect. Check your internet and try again.",
  'entry.fine': "Your key isn't stored in this browser: you sign in once and it remembers you.",

  // espacio de trabajo y HUD
  'hud.overview': 'Overview',
  'hud.loading': 'Loading the plan…',
  'hud.loadError': "Couldn't load the plan.",
  'hud.retry': 'Try again',
  'hud.noProjects': 'No projects yet. When the factory creates one, it shows up here.',
  'hud.reconnecting': 'Reconnecting…',
  'hud.projects': 'Your projects',
  'hud.logout': 'Sign out',
  'hud.demoNote': 'Sample project · no server',
  'hud.liveIn': 'now in',
  'hud.stages': 'Project stages',
  'hud.sky': 'The project plan as a constellation',

  // ficha
  'card.close': 'Close',
  'card.needs': 'Needs',
  'card.unlocks': 'Once done, this starts',
  'card.notStarted': "Hasn't started yet. It starts on its own once what it needs is done.",
  'card.waitsYou': 'waiting for your answer',
  'card.report': 'Report',
  'card.reportBasalt': 'Report in Basalt',
  'card.technical': 'Technical details',
  'card.open': 'Open',
  'card.yourAnswers': 'Your answers',
  'card.messages': 'Messages for you',
  'card.sending': 'Sending…',
  'card.send': 'Send',
  'card.cancel': 'Cancel',
  'card.approve': 'Approve',
  'card.requestChanges': 'Request changes',
  'card.changesLabel': 'What needs to change?',
  'card.changesPlaceholder': 'Keep it short; the team gets it as you write it.',
  'card.sendChanges': 'Send changes',
  'card.unlock': 'Unblock',
  'card.access': 'Access',
  'card.accessPlaceholder': 'Paste the value',
  'card.accessMissing': 'The value is missing',
  'card.accessFine': "It's stored encrypted and only the team that asked for it gets it. It won't be shown here again.",
  'card.sendError': "Couldn't send. Check your connection and try again.",
  'card.alreadyResolved': 'Someone already answered it. Here is the latest.',
  'card.notFound': "Can't find that request. Reload the page.",

  // tus respuestas
  'answer.decision': 'You decided',
  'answer.review': 'You reviewed',
  'answer.access': 'You provided an access',
  'answer.by': '{who} answered',
  'answer.agent': 'An agent',
  'resolution.access': 'Access provided',
  'resolution.approved': 'Approved',
  'resolution.approvedNote': 'Approved · {note}',
  'resolution.changes': 'You requested changes',
  'resolution.changesNote': 'You requested changes: {note}',
  'resolution.choice': '“{choice}”',
  'resolution.choiceNote': '“{choice}” · {note}',
  'resolution.decided': 'Decided',

  // avisos
  'toast.teamContinues': 'the team carries on',
  'toast.isDone': 'is done',
  'toast.started': 'started',
  'toast.added': 'was added to the plan',
  'toast.removed': 'was removed from the plan',
  'notice.title': 'Needs you',
  'notice.notifyMe': 'Notify me',
  'notice.notifyMeHint': "I'll let you know in this browser when something needs you, even if you're on another tab.",

  // el cielo, cuando el navegador no puede dibujarlo
  'scene.noWebgl': "This browser doesn't support WebGL. Open it in Chrome, Safari or Firefox on a computer.",
} satisfies Record<string, Message>;

export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, Message>;

export const es: Catalog = {
  'lang.name': 'Español',
  'lang.switch': 'Idioma',
  'time.justNow': 'hace un momento',

  'status.done': 'Lista',
  'status.working': 'En progreso',
  'status.blocked': 'Te espera',
  'status.pending': 'Pendiente',

  'block.decision': 'Necesita tu decisión',
  'block.review': 'Necesita tu revisión',
  'block.access': 'Necesita un acceso',
  'blockToast.decision': 'necesita tu decisión',
  'blockToast.review': 'necesita tu revisión',
  'blockToast.access': 'necesita un acceso',

  'count.done': { zero: 'Sin tareas', one: '{done} de {total} lista', other: '{done} de {total} listas' },
  'count.waiting': { zero: 'Nada te espera', one: '{count} te espera', other: '{count} te esperan' },
  'team.name': 'Equipo de {team}',

  'entry.title': 'Tu fábrica, en un cielo',
  'entry.lead': 'Pega tu clave de acceso para ver tus proyectos.',
  'entry.label': 'Clave de acceso',
  'entry.placeholder': 'Pega tu clave',
  'entry.cta': 'Entrar',
  'entry.checking': 'Entrando…',
  'entry.bad': 'Esa clave no sirve. Revisa que la hayas copiado completa.',
  'entry.empty': 'Falta la clave.',
  'entry.expired': 'Tu sesión venció. Vuelve a pegar tu clave.',
  'entry.offline': 'No pude conectarme. Revisa tu internet e intenta de nuevo.',
  'entry.fine': 'La clave no se guarda en este navegador: entras una vez y te recuerda.',

  'hud.overview': 'Vista general',
  'hud.loading': 'Cargando el plan…',
  'hud.loadError': 'No pude cargar el plan.',
  'hud.retry': 'Reintentar',
  'hud.noProjects': 'Todavía no hay proyectos. Cuando la fábrica cree uno, aparece aquí.',
  'hud.reconnecting': 'Reconectando…',
  'hud.projects': 'Tus proyectos',
  'hud.logout': 'Salir',
  'hud.demoNote': 'Proyecto de ejemplo · sin servidor',
  'hud.liveIn': 'ahora en',
  'hud.stages': 'Etapas del proyecto',
  'hud.sky': 'El plan del proyecto como una constelación',

  'card.close': 'Cerrar',
  'card.needs': 'Necesita',
  'card.unlocks': 'Cuando esté lista, arranca',
  'card.notStarted': 'Todavía no empieza. Arranca sola cuando esté listo lo que necesita.',
  'card.waitsYou': 'espera tu respuesta',
  'card.report': 'Informe',
  'card.reportBasalt': 'Informe en Basalt',
  'card.technical': 'Detalle técnico',
  'card.open': 'Abrir',
  'card.yourAnswers': 'Tus respuestas',
  'card.messages': 'Lo que te escribieron',
  'card.sending': 'Enviando…',
  'card.send': 'Enviar',
  'card.cancel': 'Cancelar',
  'card.approve': 'Aprobar',
  'card.requestChanges': 'Pedir cambios',
  'card.changesLabel': '¿Qué hay que cambiar?',
  'card.changesPlaceholder': 'Escríbelo en corto; le llega al equipo tal cual.',
  'card.sendChanges': 'Enviar cambios',
  'card.unlock': 'Desbloquear',
  'card.access': 'Acceso',
  'card.accessPlaceholder': 'Pega el valor',
  'card.accessMissing': 'Falta el valor',
  'card.accessFine': 'Se guarda cifrado y solo lo recibe el equipo que lo pidió. No vuelve a mostrarse aquí.',
  'card.sendError': 'No se pudo enviar. Revisa tu conexión e intenta de nuevo.',
  'card.alreadyResolved': 'Alguien ya lo resolvió. Te muestro lo último.',
  'card.notFound': 'No encuentro ese pedido. Recarga la página.',

  'answer.decision': 'Decidiste',
  'answer.review': 'Revisaste',
  'answer.access': 'Entregaste un acceso',
  'answer.by': '{who} respondió',
  'answer.agent': 'Un agente',
  'resolution.access': 'Acceso entregado',
  'resolution.approved': 'Aprobado',
  'resolution.approvedNote': 'Aprobado · {note}',
  'resolution.changes': 'Pediste cambios',
  'resolution.changesNote': 'Pediste cambios: {note}',
  'resolution.choice': '«{choice}»',
  'resolution.choiceNote': '«{choice}» · {note}',
  'resolution.decided': 'Decidido',

  'toast.teamContinues': 'el equipo sigue',
  'toast.isDone': 'está lista',
  'toast.started': 'arrancó',
  'toast.added': 'se agregó al plan',
  'toast.removed': 'salió del plan',
  'notice.title': 'Te espera',
  'notice.notifyMe': 'Avisarme',
  'notice.notifyMeHint': 'Te aviso en este navegador cuando algo te espere, aunque estés en otra pestaña.',

  'scene.noWebgl': 'Este navegador no tiene WebGL. Ábrelo en Chrome, Safari o Firefox de escritorio.',
};
