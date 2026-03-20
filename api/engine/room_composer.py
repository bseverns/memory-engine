ROOM_LOOP_CONFIG = {
    "intensityProfiles": {
        "quiet": {
            "name": "quiet",
            "cueGapMultiplier": 1.24,
            "pauseGapMultiplier": 1.35,
            "roomToneMultiplier": 1.15,
        },
        "balanced": {
            "name": "balanced",
            "cueGapMultiplier": 1.0,
            "pauseGapMultiplier": 1.0,
            "roomToneMultiplier": 1.0,
        },
        "active": {
            "name": "active",
            "cueGapMultiplier": 0.82,
            "pauseGapMultiplier": 0.78,
            "roomToneMultiplier": 0.92,
        },
    },
    "movementPresets": {
        "meditative": {
            "name": "meditative",
            "movementGapMultiplier": 1.18,
            "minItemsDelta": 1,
            "maxItemsDelta": 1,
        },
        "balanced": {
            "name": "balanced",
            "movementGapMultiplier": 1.0,
            "minItemsDelta": 0,
            "maxItemsDelta": 0,
        },
        "active": {
            "name": "active",
            "movementGapMultiplier": 0.88,
            "minItemsDelta": 0,
            "maxItemsDelta": -1,
        },
    },
    "scenes": [
        {
            "name": "clearings",
            "movements": ["arrival", "release"],
            "moods": ["clear", "hushed"],
            "cues": [
                {"lane": "fresh", "density": "light", "mood": "clear", "gapMs": 950},
                {"lane": "fresh", "density": "medium", "mood": "clear", "gapMs": 1600},
                {"pauseMs": 2600, "toneLevel": "sparse"},
            ],
        },
        {
            "name": "weathered cluster",
            "movements": ["weathering"],
            "moods": ["weathered", "suspended"],
            "cues": [
                {"lane": "worn", "density": "medium", "mood": "weathered", "gapMs": 1600},
                {"lane": "worn", "density": "dense", "mood": "weathered", "gapMs": 2500},
                {"pauseMs": 3600, "toneLevel": "sparse"},
            ],
        },
        {
            "name": "suspension",
            "movements": ["arrival", "weathering"],
            "moods": ["suspended", "hushed"],
            "cues": [
                {"lane": "mid", "density": "medium", "mood": "suspended", "gapMs": 1850},
                {"pauseMs": 2200, "toneLevel": "idle"},
                {"lane": "worn", "density": "light", "mood": "hushed", "gapMs": 2100},
            ],
        },
        {
            "name": "gathering",
            "movements": ["gathering"],
            "moods": ["gathering", "clear", "suspended"],
            "cues": [
                {"lane": "fresh", "density": "medium", "mood": "clear", "gapMs": 1050},
                {"lane": "any", "density": "dense", "mood": "gathering", "gapMs": 1550},
                {"lane": "mid", "density": "medium", "mood": "suspended", "gapMs": 2200},
            ],
        },
        {
            "name": "hushed drift",
            "movements": ["arrival", "release"],
            "moods": ["hushed", "clear"],
            "cues": [
                {"lane": "mid", "density": "light", "mood": "hushed", "gapMs": 1200},
                {"pauseMs": 2800, "toneLevel": "sparse"},
                {"lane": "fresh", "density": "light", "mood": "clear", "gapMs": 1700},
            ],
        },
        {
            "name": "afterimage",
            "movements": ["weathering", "release"],
            "moods": ["weathered", "hushed", "suspended"],
            "cues": [
                {"lane": "worn", "density": "light", "mood": "weathered", "gapMs": 1700},
                {"lane": "mid", "density": "medium", "mood": "suspended", "gapMs": 2500},
                {"pauseMs": 3400, "toneLevel": "sparse"},
            ],
        },
    ],
    "movements": [
        {
            "name": "arrival",
            "minItems": 2,
            "maxItems": 3,
            "gapMultiplier": 1.15,
            "preferredMoods": ["clear", "hushed", "suspended"],
            "sceneNames": ["clearings", "hushed drift", "suspension"],
        },
        {
            "name": "gathering",
            "minItems": 3,
            "maxItems": 4,
            "gapMultiplier": 0.82,
            "preferredMoods": ["gathering", "clear", "suspended"],
            "sceneNames": ["gathering", "suspension"],
        },
        {
            "name": "weathering",
            "minItems": 2,
            "maxItems": 4,
            "gapMultiplier": 1.12,
            "preferredMoods": ["weathered", "suspended", "hushed"],
            "sceneNames": ["weathered cluster", "afterimage", "suspension"],
        },
        {
            "name": "release",
            "minItems": 2,
            "maxItems": 3,
            "gapMultiplier": 1.28,
            "preferredMoods": ["hushed", "clear", "weathered"],
            "sceneNames": ["clearings", "hushed drift", "afterimage"],
        },
    ],
    "tone": {
        "idleGain": 0.011,
        "sparseGain": 0.017,
        "duckGain": 0.002,
        "fadeSeconds": 1.25,
    },
}
