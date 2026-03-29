import sys
import json
import flask.sansio.blueprints as _bp
_orig_init = _bp.Blueprint.__init__
def _patched_init(self, name, *args, **kwargs):
    if not name:
        name = 'pydmxcontrol'
    _orig_init(self, name, *args, **kwargs)
_bp.Blueprint.__init__ = _patched_init

from PyDMXControl.controllers import uDMXController
from PyDMXControl.profiles.Generic import Custom

dmx = uDMXController()
universe = dmx.add_fixture(Custom, start_channel=1, channels=64, name="universe")

def set_channel(address, value):
    universe.set_channel(address - 1, value)

print("READY", flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    if line == "quit":
        break
    try:
        channels = json.loads(line)
        for ch, val in channels.items():
            set_channel(int(ch), int(val))
    except Exception as e:
        print(f"ERROR {e}", flush=True)

dmx.close()
