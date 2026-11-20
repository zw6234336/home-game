import { renderMarkup } from './utils/dom.mjs';
import { icon } from './icons.mjs';

export function createPlayfield(container, gentle, onHit, onMiss) {
  const bubbles = new Map();
  const effects = [];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let serial = 0;
  let elapsed = 0;
  let spawnAge = 0;
  let active = false;

  function spawn() {
    if (bubbles.size >= (gentle ? 4 : 6)) return;
    const used = new Set([...bubbles.values()].map(bubble => bubble.slot));
    const free = Array.from({ length: gentle ? 6 : 9 }, (_, index) => index).filter(slot => !used.has(slot));
    const slot = free[Math.floor(Math.random() * free.length)];
    const x = [17, 50, 83][slot % 3];
    const y = (gentle ? [40, 72] : [22, 49, 76])[Math.floor(slot / 3)];
    const element = document.createElement('button');
    const id = 'bubble-' + (++serial);
    element.type = 'button';
    element.className = 'bubble color-' + (serial % 4);
    element.dataset.bubble = id;
    element.setAttribute('aria-label', '拍泡泡 ' + serial);
    element.style.left = x + '%';
    element.style.top = y + '%';
    renderMarkup(element, icon('spark'));
    container.append(element);
    bubbles.set(id, { element, slot, x, y, age: 0 });
  }

  function pop(id) {
    if (!active || !bubbles.has(id)) return;
    const bubble = bubbles.get(id);
    if (!onHit(id)) return;
    const focused = bubble.element.matches(':focus');
    bubble.element.remove();
    bubbles.delete(id);
    if (focused) bubbles.values().next().value?.element.focus({ preventScroll: true });
    const label = document.createElement('span');
    label.className = 'pop-label';
    label.textContent = '+10';
    label.style.left = bubble.x + '%';
    label.style.top = bubble.y + '%';
    container.append(label);
    effects.push({ label, age: 0 });
  }

  function targetHit(event) {
    const button = event.target.closest('[data-bubble]');
    if (button) pop(button.dataset.bubble);
  }

  container.addEventListener('pointermove', targetHit);
  container.addEventListener('click', targetHit);

  function update(delta) {
    if (!active) return;
    elapsed += delta;
    spawnAge += delta;
    if (spawnAge >= (gentle ? 1200 : 850)) {
      spawnAge = 0;
      spawn();
    }
    for (const [id, bubble] of bubbles) {
      bubble.age += delta;
      if (bubble.age > (gentle ? 8500 : 5500)) {
        bubble.element.remove();
        bubbles.delete(id);
        onMiss();
      } else if (!reduced) {
        const drift = Math.sin(elapsed / 900 + bubble.slot) * (gentle ? 0.6 : 1.6);
        bubble.element.style.top = (bubble.y + drift) + '%';
      }
    }
    for (let index = effects.length - 1; index >= 0; index--) {
      effects[index].age += delta;
      if (effects[index].age > 650) {
        effects[index].label.remove();
        effects.splice(index, 1);
      }
    }
  }

  return {
    update,
    setActive(value) {
      active = value;
      for (const bubble of bubbles.values()) bubble.element.disabled = !value;
      if (value && bubbles.size === 0) for (let index = 0; index < 5; index++) spawn();
    },
    destroy() {
      active = false;
      container.removeEventListener('pointermove', targetHit);
      container.removeEventListener('click', targetHit);
      container.replaceChildren();
      bubbles.clear();
    }
  };
}
