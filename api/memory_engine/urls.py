from django.contrib import admin
from django.urls import path, include
from engine.api_views import healthz
from engine.views import kiosk_view, operator_dashboard_view, playback_view

urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", healthz, name="healthz"),
    path("api/v1/", include("engine.urls")),
    path("kiosk/", kiosk_view, name="kiosk"),
    path("room/", playback_view, name="room-playback"),
    path("ops/", operator_dashboard_view, name="operator-dashboard"),
]
