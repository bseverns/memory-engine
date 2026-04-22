const test = require("node:test");
const assert = require("node:assert/strict");

const operatorLite = require("../api/engine/static/engine/operator-dashboard-lite.js");

test("classifyState returns ready when no failed components or warnings", () => {
  const state = operatorLite.classifyState({
    components: {
      database: { ok: true },
      redis: { ok: true },
      storage: { ok: true },
    },
    warnings: [],
  });

  assert.equal(state.state, "ready");
  assert.equal(state.title, "Ready");
});

test("classifyState returns broken on hard dependency failure", () => {
  const state = operatorLite.classifyState({
    components: {
      database: { ok: false, error: "down" },
      redis: { ok: true },
      storage: { ok: true },
    },
    warnings: [],
  });

  assert.equal(state.state, "broken");
  assert.equal(state.title, "Broken");
});

test("recommendedStage chooses incident for degraded or maintenance posture", () => {
  assert.equal(
    operatorLite.recommendedStage(
      { operator_state: { maintenance_mode: true }, playable: 12 },
      { state: "ready" },
    ),
    "incident",
  );
  assert.equal(
    operatorLite.recommendedStage(
      { operator_state: { maintenance_mode: false }, playable: 12 },
      { state: "degraded" },
    ),
    "incident",
  );
});

test("recommendedTab maps incident posture to Fix Problem", () => {
  const tab = operatorLite.recommendedTab(
    { operator_state: { maintenance_mode: false }, playable: 12 },
    { state: "degraded" },
  );

  assert.equal(tab, "fix-problem");
});

test("nextActionText favors calm live guidance when healthy and unpaused", () => {
  const text = operatorLite.nextActionText(
    {
      operator_state: {
        maintenance_mode: false,
        intake_paused: false,
        playback_paused: false,
      },
      warnings: [],
      playable: 5,
    },
    { state: "ready" },
  );

  assert.match(text, /Open `\/kiosk\/` and `\/room\/`/);
});

test("buildArchiveCommand keeps local default and safely quotes USB paths", () => {
  assert.equal(
    operatorLite.buildArchiveCommand(""),
    "./scripts/session_close_archive.sh",
  );
  assert.equal(
    operatorLite.buildArchiveCommand("/media/steward/SESSION ARCHIVE"),
    "./scripts/session_close_archive.sh --to-usb '/media/steward/SESSION ARCHIVE'",
  );
  assert.equal(
    operatorLite.buildArchiveCommand("/media/steward/it's-safe"),
    "./scripts/session_close_archive.sh --to-usb '/media/steward/it'\\''s-safe'",
  );
});

test("buildArchiveCommandResult rejects non-absolute USB paths safely", () => {
  const result = operatorLite.buildArchiveCommandResult("SESSION_ARCHIVE");

  assert.equal(result.command, "./scripts/session_close_archive.sh");
  assert.match(result.error, /must be absolute/i);
});

test("validateUsbPath rejects control characters", () => {
  const result = operatorLite.validateUsbPath("/media/steward/SESSION\nARCHIVE");

  assert.equal(result.ok, false);
  assert.match(result.error, /unsafe control characters/i);
});

test("tab helpers normalize and parse persisted tab keys", () => {
  assert.equal(operatorLite.normalizeTabKey("FIX-PROBLEM"), "fix-problem");
  assert.equal(operatorLite.tabKeyFromHash("#ops-tab=close-session"), "close-session");
  assert.equal(operatorLite.tabKeyFromHash("#run-room"), "run-room");
  assert.equal(operatorLite.tabKeyFromHash("#unknown"), "");
  assert.deepEqual(operatorLite.TAB_KEYS, ["open-room", "run-room", "fix-problem", "close-session"]);
});

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.tabIndex = 0;
    this.className = "";
    this.dataset = {};
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(handler);
  }

  dispatch(type, event = {}) {
    const handlers = this.listeners.get(type) || [];
    const baseEvent = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
      ...event,
    };
    for (const handler of handlers) {
      handler(baseEvent);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  replaceChildren(...children) {
    this.children = children;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  focus() {
    this.focused = true;
  }
}

class FakeDocument {
  constructor() {
    this.nodes = new Map();
    this.cookie = "csrftoken=test-token";
    this.tabNodes = [];
    this.tabPanelNodes = [];
  }

  set(id, node) {
    this.nodes.set(id, node);
    return node;
  }

  getElementById(id) {
    return this.nodes.get(id) || null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-tab]") return this.tabNodes;
    if (selector === "[data-tab-panel]") return this.tabPanelNodes;
    return [];
  }

  createElement(tagName) {
    const node = new FakeElement();
    node.tagName = String(tagName || "div").toUpperCase();
    return node;
  }
}

function createLiteDomHarness() {
  const doc = new FakeDocument();
  const ids = [
    "opsLiteStateTitle",
    "opsLiteStateBadge",
    "opsLiteNextAction",
    "opsLiteRefreshed",
    "opsLiteControlsForm",
    "opsLiteMaintenanceMode",
    "opsLiteIntakePaused",
    "opsLitePlaybackPaused",
    "opsLiteQuieterMode",
    "opsLiteControlsSave",
    "opsLiteClearSessionFraming",
    "opsLiteClearSessionFramingTab",
    "opsLiteControlStatus",
    "opsLiteSessionFramingStatus",
    "opsLiteRunSessionFramingStatus",
    "opsLiteAudioTone",
    "opsLiteAudioToneOpenRoom",
    "opsLitePlayable",
    "opsLiteWarningCount",
    "opsLiteStorage",
    "opsLiteLastAction",
    "opsLiteWarnings",
    "opsLiteRecommendedStage",
    "opsLiteReadyCue",
    "opsLiteRunPosture",
    "opsLiteRunGuidance",
    "opsLiteRunControlState",
    "opsLiteRunSnapshot",
    "opsLiteFixReason",
    "opsLiteArchiveReadiness",
    "opsLiteArchiveUsbPath",
    "opsLiteArchiveCommandBuild",
    "opsLiteArchiveCommandCopy",
    "opsLiteArchiveCommand",
    "ops-operator-state",
  ];
  for (const id of ids) {
    doc.set(id, new FakeElement(id));
  }
  doc.getElementById("ops-operator-state").textContent = JSON.stringify({
    maintenance_mode: false,
    intake_paused: false,
    playback_paused: false,
    quieter_mode: false,
    session_theme_title: "",
    session_theme_prompt: "",
    deployment_focus_topic: "",
    deployment_focus_status: "",
  });

  const tabSpecs = [
    ["opsLiteTabOpenRoom", "open-room"],
    ["opsLiteTabRunRoom", "run-room"],
    ["opsLiteTabFixProblem", "fix-problem"],
    ["opsLiteTabCloseSession", "close-session"],
  ];
  for (const [id, key] of tabSpecs) {
    const tab = new FakeElement(id);
    tab.dataset.tab = key;
    doc.set(id, tab);
    doc.tabNodes.push(tab);
  }

  const panelSpecs = [
    ["opsLitePanelOpenRoom", "open-room"],
    ["opsLitePanelRunRoom", "run-room"],
    ["opsLitePanelFixProblem", "fix-problem"],
    ["opsLitePanelCloseSession", "close-session"],
  ];
  for (const [id, key] of panelSpecs) {
    const panel = new FakeElement(id);
    panel.dataset.tabPanel = key;
    panel.hidden = key !== "open-room";
    doc.set(id, panel);
    doc.tabPanelNodes.push(panel);
  }

  return doc;
}

async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("start drives compact operator lite flows: tabs, controls, framing clear, and archive safety", async () => {
  const doc = createLiteDomHarness();
  const postBodies = [];
  let operatorState = {
    maintenance_mode: false,
    intake_paused: false,
    playback_paused: false,
    quieter_mode: false,
    session_theme_title: "Arrival and thresholds",
    session_theme_prompt: "Offer one small sound.",
    deployment_focus_topic: "entry_gate",
    deployment_focus_status: "open",
  };

  const originalLocation = globalThis.location;
  const originalHistory = globalThis.history;
  const originalLocalStorage = globalThis.localStorage;
  globalThis.location = { hash: "#ops-tab=run-room" };
  globalThis.history = {
    replaceState(_state, _title, hash) {
      globalThis.location.hash = String(hash);
    },
  };
  globalThis.localStorage = {
    store: new Map(),
    setItem(key, value) {
      this.store.set(key, String(value));
    },
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null;
    },
  };

  async function fetchImpl(url, options = {}) {
    if (url === "/api/v1/node/status") {
      return {
        ok: true,
        async json() {
          return {
            components: {
              database: { ok: true },
              redis: { ok: true },
              storage: { ok: true },
            },
            playable: 9,
            warnings: [{
              level: "warning",
              title: "Storage pressure is rising",
              detail: "8.1 GB free (12.4%).",
            }],
            storage: {
              state: "warning",
              free_gb: 8.1,
            },
            operator_state: { ...operatorState },
          };
        },
      };
    }
    if (url === "/api/v1/operator/controls" && (!options.method || options.method === "GET")) {
      return {
        ok: true,
        async json() {
          return {
            operator_state: { ...operatorState },
            recent_actions: [{
              detail: "controls loaded",
              created_at: "2026-03-20T10:00:00Z",
            }],
          };
        },
      };
    }
    if (url === "/api/v1/operator/controls" && options.method === "POST") {
      const payload = JSON.parse(options.body || "{}");
      postBodies.push(payload);
      operatorState = {
        ...operatorState,
        ...payload,
      };
      return {
        ok: true,
        async json() {
          return {
            operator_state: { ...operatorState },
            recent_actions: [{
              detail: "controls updated",
              created_at: "2026-03-20T10:01:00Z",
            }],
          };
        },
      };
    }
    return {
      ok: false,
      status: 404,
      async json() {
        return {};
      },
    };
  }

  const controller = operatorLite.start({
    doc,
    fetchImpl,
    intervalMs: 999999,
  });

  try {
    await flushAsync();

    assert.equal(doc.getElementById("opsLiteStateTitle").textContent, "Degraded");
    assert.match(doc.getElementById("opsLiteRecommendedStage").textContent, /Fix Problem|Run Room|Open Room|Close Session/);
    assert.equal(doc.getElementById("opsLitePanelRunRoom").hidden, false);

    const tabFix = doc.getElementById("opsLiteTabFixProblem");
    tabFix.dispatch("keydown", { key: "Enter", preventDefault() {} });
    assert.equal(doc.getElementById("opsLitePanelFixProblem").hidden, false);
    assert.equal(tabFix.getAttribute("aria-selected"), "true");

    const tabClose = doc.getElementById("opsLiteTabCloseSession");
    tabClose.dispatch("click");
    assert.equal(doc.getElementById("opsLitePanelCloseSession").hidden, false);
    assert.equal(globalThis.location.hash, "#ops-tab=close-session");

    doc.getElementById("opsLiteArchiveUsbPath").value = "relative/path";
    doc.getElementById("opsLiteArchiveCommandBuild").dispatch("click");
    assert.match(doc.getElementById("opsLiteArchiveReadiness").textContent, /must be absolute/i);
    assert.equal(doc.getElementById("opsLiteArchiveCommand").textContent, "./scripts/session_close_archive.sh");

    doc.getElementById("opsLiteArchiveUsbPath").value = "/media/steward/session archive";
    doc.getElementById("opsLiteArchiveCommandBuild").dispatch("click");
    assert.match(doc.getElementById("opsLiteArchiveCommand").textContent, /--to-usb '\/media\/steward\/session archive'/);

    doc.getElementById("opsLiteMaintenanceMode").checked = true;
    doc.getElementById("opsLiteIntakePaused").checked = true;
    doc.getElementById("opsLitePlaybackPaused").checked = false;
    doc.getElementById("opsLiteQuieterMode").checked = true;
    doc.getElementById("opsLiteControlsForm").dispatch("submit", { preventDefault() {} });
    await flushAsync();
    assert.equal(postBodies.some((payload) => payload.maintenance_mode === true && payload.intake_paused === true && payload.quieter_mode === true), true);

    doc.getElementById("opsLiteClearSessionFraming").dispatch("click");
    await flushAsync();
    assert.equal(
      postBodies.some((payload) => Object.prototype.hasOwnProperty.call(payload, "session_theme_title")
        && Object.prototype.hasOwnProperty.call(payload, "session_theme_prompt")
        && Object.prototype.hasOwnProperty.call(payload, "deployment_focus_topic")
        && Object.prototype.hasOwnProperty.call(payload, "deployment_focus_status")),
      true,
    );
    assert.match(doc.getElementById("opsLiteSessionFramingStatus").textContent, /No session framing\/focus overrides are active|Clearing session framing/i);
    assert.match(doc.getElementById("opsLiteRunControlState").textContent, /Active controls|No live control overrides/);
    assert.equal(Array.isArray(doc.getElementById("opsLiteWarnings").children), true);
  } finally {
    controller.stop();
    globalThis.location = originalLocation;
    globalThis.history = originalHistory;
    globalThis.localStorage = originalLocalStorage;
  }
});
