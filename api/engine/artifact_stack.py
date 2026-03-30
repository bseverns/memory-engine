from django.db.models import F

from .models import Artifact


def reserve_stack_top(deployment_code: str) -> int:
    Artifact.objects.filter(
        status=Artifact.STATUS_ACTIVE,
        deployment_kind=deployment_code,
        stack_position__gte=1,
    ).update(stack_position=F("stack_position") + 1)
    return 1


def compact_stack_after_position(deployment_code: str, removed_position: int) -> None:
    if int(removed_position or 0) <= 0:
        return
    Artifact.objects.filter(
        status=Artifact.STATUS_ACTIVE,
        deployment_kind=deployment_code,
        stack_position__gt=int(removed_position),
    ).update(stack_position=F("stack_position") - 1)

