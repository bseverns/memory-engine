from rest_framework import serializers
from .models import Artifact, Derivative

class ArtifactSerializer(serializers.ModelSerializer):
    class Meta:
        model = Artifact
        fields = [
            "id","kind","status","created_at","expires_at",
            "wear","play_count","duration_ms","effect_profile","effect_metadata"
        ]

class DerivativeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Derivative
        fields = ["id","artifact_id","kind","created_at","expires_at","uri"]
