import os

# Settings() requires these at import time with no defaults; tests shouldn't need a real
# .env or real provider keys just to exercise pure logic, so seed harmless placeholders
# before anything under app/ gets imported.
os.environ.setdefault("HUNAR_API_KEY", "test-hunar-key")
os.environ.setdefault("PDL_API_KEY", "test-pdl-key")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")
