# El diagrama de «How it works» (docs/media/how-it-works*.svg). Uso: python3 diagram.py en|es <out.svg>
import sys
T = {
 'en': dict(l1='Your coding agents', l2='Claude Code, scripts, CI', l3='dagyard CLI · MCP channel',
            c1='Dagyard', c2='one Cloudflare Worker', c3='the plan as a live graph',
            r1='You', r2='usually the PM', r3='the sky in your browser', r4='a band in Claude Code',
            a1='tasks, progress, questions', a2='your answers, in real time', a3='what waits for you, live', a4='decisions, reviews, access'),
 'es': dict(l1='Tus agentes', l2='Claude Code, scripts, CI', l3='CLI dagyard · canal MCP',
            c1='Dagyard', c2='un solo Worker de Cloudflare', c3='el plan como grafo vivo',
            r1='Tú', r2='casi siempre el PM', r3='el cielo en tu navegador', r4='una banda en Claude Code',
            a1='tareas, avance, preguntas', a2='tus respuestas, en vivo', a3='lo que te espera, en vivo', a4='lo que decides o apruebas'),
}[sys.argv[1]]
SANS = "font-family=\"-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif\""
MONO = "font-family=\"'SF Mono',SFMono-Regular,Menlo,Consolas,monospace\""
AMBER, BLUE, DIM, TXT = '#ffb347', '#7cc4ff', '#8b98ad', '#e8edf5'
W, H, CX, CY = 1100, 300, 550, 150

def t(x, y, s, size=13, fill=TXT, font=SANS, weight=400, anchor='middle'):
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" {font} font-size="{size}" font-weight="{weight}" fill="{fill}">{s}</text>'

def arrow(x1, x2, y, label, color, ly):
    return (f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{color}" stroke-width="1.6" marker-end="url(#m{color[1:]})"/>'
            + t((x1 + x2) / 2, ly, label, 11.5, color, MONO))

stars = [(42, 34, 1.1), (160, 270, 1), (330, 46, .9), (420, 262, 1.2), (690, 40, 1), (760, 262, .9), (905, 30, 1.2), (1060, 268, 1), (612, 280, .8), (250, 140, .7), (860, 150, .7)]
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="{T['l1']} → {T['c1']} ← {T['r1']}">
<defs>
{''.join(f'<marker id="m{c[1:]}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="{c}"/></marker>' for c in (AMBER, BLUE))}
<radialGradient id="bg" cx="50%" cy="50%" r="65%"><stop offset="0" stop-color="#132036"/><stop offset="1" stop-color="#04060b"/></radialGradient>
<radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#9fd3ff" stop-opacity=".55"/><stop offset="1" stop-color="#9fd3ff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="{W}" height="{H}" rx="18" fill="url(#bg)"/>
{''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#d6deea" opacity=".45"/>' for x, y, r in stars)}
<rect x="30" y="70" width="270" height="160" rx="14" fill="#0d1420" stroke="#2b3546"/>
{t(165, 122, T['l1'], 18, weight=650)}
{t(165, 148, T['l2'], 13, DIM)}
<rect x="58" y="172" width="214" height="30" rx="15" fill="#121c2c" stroke="#2b3a52"/>
{t(165, 192, T['l3'], 11.5, BLUE, MONO)}
<circle cx="{CX}" cy="{CY - 8}" r="70" fill="url(#glow)"/>
<circle cx="{CX}" cy="{CY - 8}" r="62" fill="#0a1220" stroke="#3a5a86"/>
<circle cx="{CX}" cy="{CY - 22}" r="4.5" fill="#fff"/>
{t(CX, CY + 6, T['c1'], 19, '#f4f7fb', weight=700)}
{t(CX, CY + 86, T['c2'], 12, DIM, MONO)}
{t(CX, CY + 104, T['c3'], 12, DIM, MONO)}
<rect x="800" y="70" width="270" height="160" rx="14" fill="#171208" stroke="#6b5326"/>
{t(935, 112, T['r1'], 18, weight=650)}
{t(935, 136, T['r2'], 13, DIM)}
{t(935, 172, '◆ ' + T['r3'], 12, BLUE, MONO)}
{t(935, 196, '▍ ' + T['r4'], 12, BLUE, MONO)}
{arrow(304, 484, 124, T['a1'], AMBER, 112)}
{arrow(484, 304, 168, T['a2'], BLUE, 190)}
{arrow(616, 796, 124, T['a3'], BLUE, 112)}
{arrow(796, 616, 168, T['a4'], AMBER, 190)}
</svg>
'''
open(sys.argv[2], 'w').write(svg)
