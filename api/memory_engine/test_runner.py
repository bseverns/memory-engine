from django.conf import settings
from django.test.runner import DiscoverRunner


class AppAwareDiscoverRunner(DiscoverRunner):
    """Use installed local apps as default test labels when none are provided."""

    def build_suite(self, test_labels=None, **kwargs):
        labels = list(test_labels or [])
        if not labels:
            labels = [
                app.rsplit(".", 1)[-1]
                for app in settings.INSTALLED_APPS
                if not app.startswith("django.") and app != "rest_framework"
            ]
        return super().build_suite(labels, **kwargs)
