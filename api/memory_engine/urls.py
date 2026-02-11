from django.contrib import admin
from django.urls import path, include
from engine.views import kiosk_view

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("engine.urls")),
    path("kiosk/", kiosk_view, name="kiosk"),
]
