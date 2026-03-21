(function initMemoryEngineMemoryColorCatalog(global) {
  const FALLBACK_MEMORY_COLOR_CATALOG = {
    default: "clear",
    profiles: [
      {
        code: "clear",
        version: "v1",
        family: "participant_memory_color",
        labels: {
          en: "Clear",
          es_mx_ca: "Claro",
        },
        descriptions: {
          en: "A cleaner, more present return with only a light lift.",
          es_mx_ca: "Regresa mas limpio y presente, con apenas un pequeno realce.",
        },
        processing: {
          engine: "chain_v1",
          topology: "presence_lift",
          highpass_hz: 72,
          highpass_q: 0.66,
          presence_hz: 2100,
          presence_q: 0.8,
          presence_gain_db: 1.6,
          air_hz: 5600,
          air_gain_db: 1.4,
          output_gain: 0.98,
        },
      },
    ],
  };

  function cloneCatalog(catalog) {
    return JSON.parse(JSON.stringify(catalog));
  }

  function readMemoryColorCatalogFromDom() {
    const configEl = global.document?.getElementById?.("kiosk-config");
    if (!configEl || !configEl.textContent) {
      return null;
    }
    try {
      return JSON.parse(configEl.textContent).memoryColorCatalog || null;
    } catch (error) {
      return null;
    }
  }

  function normalizeLocalizedMap(rawValue) {
    if (!rawValue || typeof rawValue !== "object") {
      return {};
    }
    return Object.entries(rawValue).reduce((acc, [language, text]) => {
      const key = String(language || "").trim().toLowerCase();
      const value = String(text || "").trim();
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  function normalizeProcessingSpec(rawProcessing, fallbackCode) {
    const source = rawProcessing && typeof rawProcessing === "object" ? rawProcessing : {};
    const normalized = { ...source };
    const topology = String(source.topology || source.kind || fallbackCode || "").trim().toLowerCase();
    normalized.engine = String(source.engine || "chain_v1").trim() || "chain_v1";
    normalized.topology = topology || String(fallbackCode || "").trim().toLowerCase();
    delete normalized.kind;
    return normalized;
  }

  function normalizeProfileSpec(rawProfile) {
    const code = String(rawProfile?.code || "").trim().toLowerCase();
    if (!code) {
      return null;
    }
    return {
      code,
      version: String(rawProfile?.version || "v1").trim() || "v1",
      family: String(rawProfile?.family || "participant_memory_color").trim() || "participant_memory_color",
      labels: normalizeLocalizedMap(rawProfile?.labels),
      descriptions: normalizeLocalizedMap(rawProfile?.descriptions),
      processing: normalizeProcessingSpec(rawProfile?.processing, code),
    };
  }

  function normalizeCatalog(rawCatalog) {
    const source = rawCatalog && typeof rawCatalog === "object" ? rawCatalog : FALLBACK_MEMORY_COLOR_CATALOG;
    const seenCodes = new Set();
    const profiles = Array.isArray(source.profiles)
      ? source.profiles
        .map(normalizeProfileSpec)
        .filter((profile) => {
          if (!profile || seenCodes.has(profile.code)) {
            return false;
          }
          seenCodes.add(profile.code);
          return true;
        })
      : [];

    if (!profiles.length) {
      return cloneCatalog(FALLBACK_MEMORY_COLOR_CATALOG);
    }

    const defaultCandidate = String(source.default || "").trim().toLowerCase();
    const defaultCode = profiles.some((profile) => profile.code === defaultCandidate)
      ? defaultCandidate
      : profiles[0].code;

    return {
      default: defaultCode,
      profiles,
    };
  }

  const catalog = normalizeCatalog(readMemoryColorCatalogFromDom());
  const profileMap = new Map(catalog.profiles.map((profile) => [profile.code, profile]));

  function getDefaultMemoryColorCode() {
    return catalog.default;
  }

  function normalizeMemoryColorCode(code, fallbackCode = getDefaultMemoryColorCode()) {
    const candidate = String(code || "").trim().toLowerCase();
    if (!candidate) {
      return String(fallbackCode || "").trim().toLowerCase();
    }
    return profileMap.has(candidate)
      ? candidate
      : String(fallbackCode || getDefaultMemoryColorCode()).trim().toLowerCase();
  }

  function getMemoryColorCatalog() {
    return catalog;
  }

  function getMemoryColorByCode(code) {
    const normalized = normalizeMemoryColorCode(code);
    return profileMap.get(normalized) || profileMap.get(getDefaultMemoryColorCode()) || null;
  }

  global.MemoryEngineMemoryColorCatalog = {
    FALLBACK_MEMORY_COLOR_CATALOG,
    getDefaultMemoryColorCode,
    getMemoryColorByCode,
    getMemoryColorCatalog,
    normalizeCatalog,
    normalizeMemoryColorCode,
    normalizeProfileSpec,
  };
}(window));
