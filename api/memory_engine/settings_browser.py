import sys

from .config_validation import validate_runtime_settings
from .settings_test import *  # noqa: F403,F401

# Browser automation profile: keep the isolated SQLite/eager-Celery test posture
# from settings_test, but serve static assets like a development server so
# Playwright can render the real kiosk and operator UI.

DEBUG = True
ROOM_FOSSIL_VISUALS_ENABLED = True
OPS_LOCAL_HEALTH_HARNESS = True

validate_runtime_settings(sys.modules[__name__])
