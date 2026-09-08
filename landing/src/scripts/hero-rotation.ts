const scene = document.querySelector<HTMLElement>(".signal-scene");
const cards = [...document.querySelectorAll<HTMLElement>("[data-hero-card]")];
const controls = document.querySelector<HTMLElement>(".hero-rotation-controls");
const toggle = document.querySelector<HTMLButtonElement>("[data-hero-toggle]");
const next = document.querySelector<HTMLButtonElement>("[data-hero-next]");
const position = document.querySelector<HTMLElement>("[data-hero-position]");

if (scene && controls && toggle && next && position && cards.length > 1) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let index = 0;
  let paused = reducedMotion.matches;
  let hovered = false;
  let visible = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    clearTimeout(timer);
    if (paused || hovered || !visible || document.hidden || scene?.contains(document.activeElement))
      return;
    timer = setTimeout(() => {
      advance();
      schedule();
    }, 4500);
  }

  function advance() {
    cards[index].setAttribute("aria-hidden", "true");
    index = (index + 1) % cards.length;
    cards[index].setAttribute("aria-hidden", "false");
    if (position) position.textContent = `${index + 1} / ${cards.length}`;
  }

  function updateToggle() {
    if (!toggle) return;
    toggle.textContent = paused ? "Play" : "Pause";
    toggle.setAttribute("aria-label", paused ? "Play post rotation" : "Pause post rotation");
    schedule();
  }

  controls.hidden = false;
  toggle.addEventListener("click", () => {
    paused = !paused;
    updateToggle();
  });
  next.addEventListener("click", () => {
    advance();
    schedule();
  });
  scene.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") {
      hovered = true;
      schedule();
    }
  });
  scene.addEventListener("pointerleave", () => {
    hovered = false;
    schedule();
  });
  scene.addEventListener("focusin", schedule);
  scene.addEventListener("focusout", () => {
    queueMicrotask(schedule);
  });
  document.addEventListener("visibilitychange", schedule);
  reducedMotion.addEventListener("change", () => {
    paused = reducedMotion.matches;
    updateToggle();
  });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  }).observe(scene);
  updateToggle();
}
