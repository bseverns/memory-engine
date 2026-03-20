from django.urls import path
from . import api_views

urlpatterns = [
    path("artifacts/audio", api_views.create_audio_artifact),
    path("ephemeral/audio", api_views.create_ephemeral_audio),
    path("ephemeral/consume", api_views.consume_ephemeral),
    path("healthz", api_views.healthz),
    path("revoke", api_views.revoke),
    path("pool/next", api_views.pool_next),
    path("surface/state", api_views.surface_state),
    path("node/status", api_views.node_status),
    path("operator/controls", api_views.operator_controls),
    path("blob/<int:artifact_id>/raw", api_views.blob_proxy_raw),
    path("derivatives/spectrograms", api_views.list_spectrograms),
]
