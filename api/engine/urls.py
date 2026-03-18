from django.urls import path
from . import views

urlpatterns = [
    path("artifacts/audio", views.create_audio_artifact),
    path("ephemeral/audio", views.create_ephemeral_audio),
    path("ephemeral/consume", views.consume_ephemeral),
    path("healthz", views.healthz),
    path("revoke", views.revoke),
    path("pool/next", views.pool_next),
    path("node/status", views.node_status),
    path("blob/<int:artifact_id>/raw", views.blob_proxy_raw),
    path("derivatives/spectrograms", views.list_spectrograms),
]
