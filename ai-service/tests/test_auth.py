import os
import unittest
from unittest import mock

from fastapi import HTTPException

from main import app, health_check, require_key


class SharedSecretTest(unittest.TestCase):
    def test_open_when_no_key_is_configured(self):
        with mock.patch.dict(os.environ, {"AI_SERVICE_KEY": ""}):
            self.assertIsNone(require_key(None))
            self.assertIsNone(require_key("anything"))

    def test_rejects_missing_or_wrong_key_when_configured(self):
        with mock.patch.dict(os.environ, {"AI_SERVICE_KEY": "s3cret"}):
            for bad in (None, "", "wrong", "s3cret "):
                with self.assertRaises(HTTPException) as ctx:
                    require_key(bad)
                self.assertEqual(ctx.exception.status_code, 401)
            self.assertIsNone(require_key("s3cret"))

    def test_non_ascii_key_does_not_crash(self):
        with mock.patch.dict(os.environ, {"AI_SERVICE_KEY": "clé"}):
            self.assertIsNone(require_key("clé"))
            with self.assertRaises(HTTPException):
                require_key("cle")

    def test_forecast_and_backtest_routes_are_protected_but_health_is_not(self):
        protected = {"/api/v1/forecast", "/api/v1/backtest"}
        seen = set()
        for route in app.routes:
            deps = [d.call for d in getattr(route, "dependant").dependencies] if hasattr(route, "dependant") else []
            if route.path in protected:
                self.assertIn(require_key, deps, route.path)
                seen.add(route.path)
            if route.path == "/health":
                self.assertNotIn(require_key, deps)
        self.assertEqual(seen, protected)

    def test_health_reports_whether_a_key_is_required(self):
        with mock.patch.dict(os.environ, {"AI_SERVICE_KEY": "x"}):
            self.assertTrue(health_check()["keyRequired"])
        with mock.patch.dict(os.environ, {"AI_SERVICE_KEY": ""}):
            self.assertFalse(health_check()["keyRequired"])


if __name__ == "__main__":
    unittest.main()
