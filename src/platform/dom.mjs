const tags = new Set('a b br button canvas circle defs div ellipse g h1 h2 h3 i img input kbd label line lineargradient li option p path polygon polyline progress radialgradient rect section select small span stop strong svg ul'.split(' '));
const attributes = new Set('id class type role tabindex hidden disabled checked selected value min max step for viewbox xmlns width height x y x1 x2 y1 y2 cx cy r rx ry d points fill fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-opacity opacity transform offset stop-color stop-opacity gradientunits gradienttransform preserveaspectratio'.split(' '));

export function renderMarkup(target, markup) {
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  for (const element of [...doc.body.querySelectorAll('*')]) {
    if (!tags.has(element.localName.toLowerCase())) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const localImage = element.localName === 'img' && (name === 'src' && /^\/art\/storybook-v1\/[a-z0-9-]+\.webp$/.test(attribute.value) || name === 'alt' || name === 'decoding');
      const allowed = attributes.has(name) || localImage || name.startsWith('aria-') || name.startsWith('data-');
      const externalPaint = /url\s*\(/i.test(attribute.value) && !/^url\(#[a-zA-Z][\w-]*\)$/.test(attribute.value);
      if (!allowed || externalPaint) element.removeAttribute(attribute.name);
    }
  }
  target.replaceChildren(...[...doc.body.childNodes].map(node => document.importNode(node, true)));
}
