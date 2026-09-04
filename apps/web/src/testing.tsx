/**
 * The jsdom harness every screen test drives.
 *
 * docs/testing.md asks for the DOM a person uses, not a rendered tree. So
 * these helpers find an element the way a person finds it — by the label or
 * the words on the button — and set a value the way a browser does, through
 * the native setter React listens to. A test that reached into props could
 * pass with the control unreachable on the screen.
 */
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

export interface Screen {
  readonly container: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}

/** Mount a component into a real document and wait for its first effects. */
export async function mount(element: ReactElement): Promise<Screen> {
  (globalThis as typeof globalThis & ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);

  await act(async () => root.render(element));
  await settle();

  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as typeof globalThis & ActEnvironment).IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

/** Let every pending promise and effect finish before asserting. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** A JSON response, the way our API answers. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const element = document.querySelector(`[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
    throw new Error(`No input has the label "${label}".`);
  }
  return element;
}

export function select(label: string): HTMLSelectElement {
  const element = document.querySelector(`[aria-label="${label}"]`);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`No select has the label "${label}".`);
  }
  return element;
}

export function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll("button")].find((candidate) => {
    return (
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label
    );
  });
  if (!(element instanceof HTMLButtonElement)) throw new Error(`No button says "${label}".`);
  return element;
}

/**
 * Set a value the way a browser does.
 *
 * React tracks the last value it wrote on the node itself, so assigning
 * `element.value` and firing `input` is ignored as a value it already knows.
 * The native setter is what makes the change real.
 */
export function setValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("This DOM cannot set an input value.");
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  if (element instanceof HTMLSelectElement) {
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}
