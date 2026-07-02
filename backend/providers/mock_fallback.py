"""
mock_fallback.py - DISABLED.
All fake/dummy data has been removed. Real provider APIs or cached data are
always used. A 502 error is returned if a provider call fails with no cache.
"""


def get_mock_data(provider_key: str, days: int = 30):
    raise RuntimeError(
        f"Mock fallback is disabled. Provider '{provider_key}' must be configured "
        "with real API credentials. See backend/.env for required keys."
    )
