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
universe = dmx.add_fixture(Custom, start_channel=1, channels=512, name="universe")
last_universe = [None] * 512

def set_channel(address, value):
    universe.set_channel(address - 1, value)

def apply_universe_delta(values):
    global last_universe

    for index, value in enumerate(values[:512], start=1):
        int_value = int(value)
        if last_universe[index - 1] == int_value:
            continue
        set_channel(index, int_value)
        last_universe[index - 1] = int_value

print("READY", flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    if line == "quit":
        break
    try:
        payload = json.loads(line)

        if isinstance(payload, list):
            apply_universe_delta(payload)
            continue

        if isinstance(payload, dict) and isinstance(payload.get("universe"), list):
            apply_universe_delta(payload["universe"])
            continue

        for ch, val in payload.items():
            channel = int(ch)
            int_value = int(val)
            set_channel(channel, int_value)
            if 1 <= channel <= 512:
                last_universe[channel - 1] = int_value
    except Exception as e:
        print(f"ERROR {e}", flush=True)

dmx.close()
