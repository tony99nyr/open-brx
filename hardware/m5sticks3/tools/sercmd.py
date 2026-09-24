"""Bench helper (not in the repo's tools yet): open a COM port, send each command, print every line for SECS.
usage: python sercmd.py COM9 SECS [cmd ...]   (a command of 'r' toggles RAW, as the rig's sketch)"""
import sys, time, serial
port, secs, cmds = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
s = serial.Serial(); s.port = port; s.baudrate = 115200; s.timeout = 0.1
s.dtr = False; s.rts = False   # the S3's USB-Serial/JTAG resets the chip on these lines
s.open()
time.sleep(0.3); s.reset_input_buffer()
for c in cmds:
    s.write((c + "\n").encode()); time.sleep(0.2)
end = time.time() + secs
while time.time() < end:
    line = s.readline()
    if line: print(f"{time.time():.3f} {line.decode(errors='replace').rstrip()}", flush=True)
s.close()
