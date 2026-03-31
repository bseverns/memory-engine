from django.contrib import admin
from django.urls import path, include
from engine.api_views import healthz, readyz
from engine.views import kiosk_view, operator_dashboard_view, operator_logout_view, playback_view, revocation_view

urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", healthz, name="healthz"),
    path("readyz", readyz, name="readyz"),
    path("api/v1/", include("engine.urls")),
    path("kiosk/", kiosk_view, name="kiosk"),
    path("room/", playback_view, name="room-playback"),
    path("revoke/", revocation_view, name="revocation"),
    path("ops/", operator_dashboard_view, name="operator-dashboard"),
    path("ops/logout/", operator_logout_view, name="operator-logout"),
]
