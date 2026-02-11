from django.contrib import admin
from .models import Node, ConsentManifest, Artifact, Derivative, AccessEvent

@admin.register(Node)
class NodeAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "location_hint", "created_at")

@admin.register(ConsentManifest)
class ConsentAdmin(admin.ModelAdmin):
    list_display = ("id", "created_at")
    readonly_fields = ("revocation_token_hash",)

@admin.register(Artifact)
class ArtifactAdmin(admin.ModelAdmin):
    list_display = ("id", "status", "kind", "created_at", "expires_at", "wear", "play_count")
    list_filter = ("status", "kind")
    search_fields = ("id",)

@admin.register(Derivative)
class DerivativeAdmin(admin.ModelAdmin):
    list_display = ("id", "artifact_id", "kind", "created_at", "expires_at")

@admin.register(AccessEvent)
class AccessEventAdmin(admin.ModelAdmin):
    list_display = ("id", "artifact_id", "ts", "context", "action")
