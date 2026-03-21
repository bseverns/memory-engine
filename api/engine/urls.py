from django.urls import path
from . import api_views

urlpatterns = [
    path("artifacts/audio", api_views.create_audio_artifact),
    path("ephemeral/audio", api_views.create_ephemeral_audio),
    path("ephemeral/consume", api_views.consume_ephemeral),
    path("healthz", api_views.healthz),
    path("revoke", api_views.revoke),
    path("pool/next", api_views.pool_next),
    path("pool/heard/<str:access_token>", api_views.pool_heard),
    path("surface/state", api_views.surface_state),
    path("surface/fossils-url", api_views.surface_fossils_feed_url),
    path("surface/fossils/<str:access_token>", api_views.surface_fossils),
    path("node/status", api_views.node_status),
    path("operator/artifact-summary", api_views.operator_artifact_summary),
    path("operator/controls", api_views.operator_controls),
    path("media/raw/<str:access_token>", api_views.media_proxy_raw),
    path("media/spectrogram/<str:access_token>", api_views.media_proxy_spectrogram),
    path("derivatives/spectrograms", api_views.list_spectrograms),
]
