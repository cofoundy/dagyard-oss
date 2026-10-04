"""tmux capture-pane -e  ->  HTML de una ventana de terminal (para capturar con Playwright).
Uso: python3 ansi2html.py <in.ans> <out.html> <title> [cols]
"""
import html
import re
import sys

BASE = ['#1c1c1c', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#d0d0d0']
BRIGHT = ['#7f848e', '#ff7a85', '#b5e890', '#ffd580', '#82c4ff', '#de9cf5', '#7fdcea', '#ffffff']


def xterm256(n):
    if n < 8:
        return BASE[n]
    if n < 16:
        return BRIGHT[n - 8]
    if n < 232:
        n -= 16
        lv = [0, 95, 135, 175, 215, 255]
        return '#%02x%02x%02x' % (lv[n // 36], lv[(n // 6) % 6], lv[n % 6])
    g = 8 + (n - 232) * 10
    return '#%02x%02x%02x' % (g, g, g)


def convert(text):
    text = re.sub(r'\x1b\][^\x07\x1b]*(\x07|\x1b\\)', '', text)
    text = re.sub(r'\x1b\[[0-9;?]*[A-Za-ln-z]', '', text)
    out = []
    st = {'fg': None, 'bg': None, 'b': False, 'd': False, 'i': False, 'u': False, 'r': False}

    def span(s):
        if not s:
            return
        fg, bg = st['fg'], st['bg']
        if st['r']:
            fg, bg = (bg or '#141414'), (fg or '#d0d0d0')
        css = []
        if fg:
            css.append(f'color:{fg}')
        if bg:
            css.append(f'background:{bg}')
        if st['b']:
            css.append('font-weight:700')
        if st['d']:
            css.append('opacity:.6')
        if st['i']:
            css.append('font-style:italic')
        if st['u']:
            css.append('text-decoration:underline')
        e = html.escape(s)
        out.append(f'<span style="{";".join(css)}">{e}</span>' if css else e)

    pos = 0
    for m in re.finditer(r'\x1b\[([0-9;:]*)m', text):
        span(text[pos:m.start()])
        pos = m.end()
        codes = [int(c) if c else 0 for c in re.split('[;:]', m.group(1))] or [0]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0:
                st.update(fg=None, bg=None, b=False, d=False, i=False, u=False, r=False)
            elif c == 1:
                st['b'] = True
            elif c == 2:
                st['d'] = True
            elif c == 3:
                st['i'] = True
            elif c == 4:
                st['u'] = True
            elif c == 7:
                st['r'] = True
            elif c == 22:
                st['b'] = st['d'] = False
            elif c == 23:
                st['i'] = False
            elif c == 24:
                st['u'] = False
            elif c == 27:
                st['r'] = False
            elif 30 <= c <= 37:
                st['fg'] = BASE[c - 30]
            elif c == 39:
                st['fg'] = None
            elif 40 <= c <= 47:
                st['bg'] = BASE[c - 40]
            elif c == 49:
                st['bg'] = None
            elif 90 <= c <= 97:
                st['fg'] = BRIGHT[c - 90]
            elif 100 <= c <= 107:
                st['bg'] = BRIGHT[c - 100]
            elif c in (38, 48) and i + 1 < len(codes):
                key = 'fg' if c == 38 else 'bg'
                if codes[i + 1] == 5 and i + 2 < len(codes):
                    st[key] = xterm256(codes[i + 2])
                    i += 2
                elif codes[i + 1] == 2 and i + 4 < len(codes):
                    st[key] = '#%02x%02x%02x' % tuple(codes[i + 2:i + 5])
                    i += 4
            i += 1
    span(text[pos:])
    return ''.join(out)


def main():
    src, dst, title = sys.argv[1], sys.argv[2], sys.argv[3]
    cols = int(sys.argv[4]) if len(sys.argv) > 4 else 120
    lines = open(src, encoding='utf-8').read().split('\n')
    while lines and not re.sub(r'\x1b\[[0-9;:]*m', '', lines[-1]).strip():
        lines.pop()
    body = convert('\n'.join(lines))
    page = f"""<!doctype html><meta charset="utf-8">
<style>
  html,body{{margin:0;background:transparent}}
  .win{{display:inline-block;margin:28px;border-radius:12px;overflow:hidden;background:#141414;
       box-shadow:0 0 0 1px #2a2a2a,0 24px 60px rgba(0,0,0,.55)}}
  .bar{{height:34px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#232323;
       font:12px/1 'SF Mono',Menlo,monospace;color:#8a8a8a}}
  .dot{{width:12px;height:12px;border-radius:50%}}
  .t{{margin-left:10px}}
  pre{{margin:0;padding:18px 20px 20px;font:15px/1.45 'SF Mono','JetBrains Mono',Menlo,monospace;color:#d0d0d0;
      width:{cols}ch;white-space:pre}}
</style>
<div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="t">{html.escape(title)}</span></div><pre>{body}</pre></div>"""
    open(dst, 'w', encoding='utf-8').write(page)


main()
