"""The GUN STAGE: a click-to-try bench page for one real gun (or a fake one).

`python -m brx_mcp stage --gun <addr> [--ir COM7]` on the machine with Bluetooth (Windows here), then open
http://127.0.0.1:8790/. Every button plays the frames the phone would write for the chosen game
profile (the compiled bundle: arm / spawn / respawn / end, every A11 event, the medal stacks, the
headset sequences), and the IR buttons make the ESP32 emitter shoot the gun so the firmware reacts
for real. See docs/gun-stage.md.
"""
