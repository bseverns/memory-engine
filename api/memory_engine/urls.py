from django.contrib import admin
from django.urls import path, include
from engine.views import kiosk_view, healthz, operator_dashboard_view

urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", healthz, name="healthz"),
    path("api/v1/", include("engine.urls")),
    path("kiosk/", kiosk_view, name="kiosk"),
    path("ops/", operator_dashboard_view, name="operator-dashboard"),
]
