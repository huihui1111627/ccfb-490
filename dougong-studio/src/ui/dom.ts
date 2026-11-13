export function h<T extends HTMLElement = HTMLElement>(tag: string, cls = '', html = ''): T {
  const el = document.createElement(tag) as T;
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

export function field(label: string, input: HTMLElement, hint = ''): HTMLElement {
  const wrap = h('label', 'field');
  wrap.append(h('span', 'field-label', label), input, hint ? h('em', 'field-hint', hint) : h('em'));
  return wrap;
}

export function numberInput(value: number, min: number, max: number, step = 1): HTMLInputElement {
  const i = h<HTMLInputElement>('input');
  i.type = 'number';
  i.value = String(value);
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  return i;
}

export function select(options: [string, string][], value: string): HTMLSelectElement {
  const s = h<HTMLSelectElement>('select');
  for (const [v, label] of options) {
    const o = h<HTMLOptionElement>('option');
    o.value = v; o.textContent = label;
    if (v === value) o.selected = true;
    s.append(o);
  }
  return s;
}

export function checkbox(label: string, checked: boolean): HTMLElement {
  const i = h<HTMLInputElement>('input');
  i.type = 'checkbox';
  i.checked = checked;
  const wrap = h('label', 'check');
  wrap.append(i, h('span', '', label));
  return wrap;
}

export function slider(value: number, min: number, max: number, step: number): HTMLInputElement {
  const i = h<HTMLInputElement>('input');
  i.type = 'range';
  i.value = String(value);
  i.min = String(min); i.max = String(max); i.step = String(step);
  return i;
}

export function pageLayout(canvas: HTMLCanvasElement, panel: HTMLElement): HTMLElement {
  const root = h('div', 'page');
  const stage = h('div', 'stage');
  stage.append(canvas);
  root.append(stage, panel);
  return root;
}

export function statBar(items: [string, string][]): HTMLElement {
  const bar = h('div', 'statbar');
  for (const [k, v] of items) bar.append(h('span', 'stat', `<em>${k}</em><b>${v}</b>`));
  return bar;
}
