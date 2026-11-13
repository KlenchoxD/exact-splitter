"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

class Element {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.parentNode = null;
    this.value = "";
    this.textContent = "";
    this.disabled = false;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  append(...elements) {
    for (const element of elements) {
      if (element.parentNode) element.remove();
      element.parentNode = this;
      this.children.push(element);
    }
  }

  replaceChildren(...elements) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...elements);
  }

  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentNode = null;
  }

  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const match = child.find(predicate);
      if (match) return match;
    }
    return null;
  }

  querySelector(selector) {
    if (selector === "button") return this.find((element) => element.tagName === "button");
    const label = selector.match(/^\[aria-label="([^"]+)"\]$/)?.[1];
    if (label === undefined) return null;
    return this.find((element) => element.attributes["aria-label"] === label);
  }
}

function openExplorer() {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /<script src="\.\/*allocator\.js"><\/script>/);
  const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inlineScript, "the explorer inline script is present");

  const ids = [
    "payee-list",
    "amount",
    "status",
    "result-rows",
    "add-payee",
    "calculate",
    "sample-seven",
    "sample-paradox",
    "sample-max",
    "sum-pool",
    "sum-weight",
    "sum-leftover",
    "result-note",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element("div")]));
  elements.amount.value = "7";
  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = new Element("div");
      return elements[id];
    },
    createElement(tagName) {
      return new Element(tagName);
    },
  };

  vm.runInNewContext(inlineScript, {
    document,
    window: { ExactSplitterAllocator: require("./allocator.js") },
  });
  return elements;
}

test("explorer renders the default split and Alabama-paradox preset", () => {
  const elements = openExplorer();
  assert.equal(elements["sum-pool"].textContent, "7 wei");
  assert.equal(elements["sum-leftover"].textContent, "1");
  assert.deepEqual(
    elements["result-rows"].children.map((row) => row.children[5].textContent),
    ["3", "2", "2"],
  );

  elements["sample-paradox"].listeners.click();
  assert.equal(elements["sum-pool"].textContent, "4 wei");
  assert.equal(elements["sum-leftover"].textContent, "2");
  assert.deepEqual(
    elements["result-rows"].children.map((row) => row.children[5].textContent),
    ["0", "2", "2"],
  );
});

test("explorer clears the previous note when input becomes invalid", () => {
  const elements = openExplorer();
  elements["result-note"].textContent = "previous successful allocation";
  const secondPayee = elements["payee-list"].children[1];
  secondPayee.querySelector('[aria-label="Payee weight"]').value = "0";
  elements["payee-list"].listeners.input();

  assert.match(elements.status.textContent, /Weight 2 is outside the allowed range/);
  assert.equal(elements["result-note"].textContent, "");
  assert.equal(elements["sum-pool"].textContent, "—");
  assert.equal(elements["result-rows"].children.length, 0);
});
