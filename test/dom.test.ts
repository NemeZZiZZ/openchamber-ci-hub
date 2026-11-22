import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { h } from '../src/ui/dom.ts';

// A stand-in document: enough of an element for h() to wire attributes and listeners.
class FakeElement {
  listeners = new Map<string, unknown>();
  attributes = new Map<string, string>();
  className = '';
  textContent = '';
  addEventListener(type: string, fn: unknown) {
    this.listeners.set(type, fn);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  append() {}
}

const realDocument = globalThis.document;
beforeEach(() => {
  (globalThis as { document: unknown }).document = { createElement: () => new FakeElement() };
});
afterEach(() => {
  (globalThis as { document: unknown }).document = realDocument;
});

describe('h', () => {
  test('wires onClick to the click event the browser fires', () => {
    const onClick = () => undefined;
    const node = h('button', { onClick }) as unknown as FakeElement;
    expect(node.listeners.get('click')).toBe(onClick);
    expect(node.listeners.has('Click')).toBe(false);
  });

  test('keeps lowercase handlers working', () => {
    const onclick = () => undefined;
    const node = h('button', { onclick }) as unknown as FakeElement;
    expect(node.listeners.get('click')).toBe(onclick);
  });
});
