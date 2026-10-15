(function () {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = n => String(n).padStart(2, '0');
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // Attributes only; inline styles are blocked by the CSP, so callers set node.style afterwards.
  function el(tag, attrs = {}, children = []) {
    const node = tag.startsWith('svg:') ? document.createElementNS(SVG, tag.slice(4)) : document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  // 16×16 stand-ins for the SF Symbols the original uses.
  const ICONS = {
    percent: ['stroke', [['circle', { cx: 4.5, cy: 4.5, r: 1.9 }], ['circle', { cx: 11.5, cy: 11.5, r: 1.9 }], ['path', { d: 'M12.5 3.5l-9 9' }]]],
    flame: ['fill', [['path', { d: 'M8 1c.6 2.4 4.5 4 4.5 8.2a4.5 4.5 0 0 1-9 0c0-2 1-3.3 2-4.2.1 1.5.8 2.4 1.7 2.8C7 5.5 7.1 3.2 8 1z' }]]],
    number: ['stroke', [['path', { d: 'M6.2 2.5 5 13.5M11 2.5 9.8 13.5M2.8 6h11M2.2 10h11' }]]],
    gear: ['stroke', [['circle', { cx: 8, cy: 8, r: 2.2 }], ['circle', { cx: 8, cy: 8, r: 4.6 }], ['path', { d: 'M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M3.5 12.5l1.2-1.2M11.3 4.7l1.2-1.2' }]]],
    chart: ['stroke', [['path', { d: 'M3.5 12V8.5M6.5 12V4.5M9.5 12V6.5M12.5 12V9M2 14.2h12' }]]],
    back: ['stroke', [['path', { d: 'M10 3 5 8l5 5' }]]],
  };
  function icon(name) {
    const [kind, body] = ICONS[name];
    return el('svg:svg', { class: `icon-svg ${kind}`, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, body.map(([tag, attrs]) => el(`svg:${tag}`, attrs)));
  }

  const logo = (id, className) => el('img', { class: className, src: `../../assets/logos/${id}.svg`, alt: '', draggable: 'false' });
  const fmtInt = n => Math.round(n).toLocaleString('en-US');
  // "Mon 12 Oct at 15:30 – 15:45"
  const periodText = (start, end) => `${DAYS[start.getDay()]} ${start.getDate()} ${MONTHS[start.getMonth()]} at ${hm(start)} – ${hm(end)}`;

  window.HudDom = { el, icon, logo, fmtInt, periodText, hm };
})();
