#!/bin/bash
# F297 cold-connect loop for one Android phone (bench 2026-09-28, Part 2).
# Each run: force-stop the app, wait 8 s, launch it, hold <hold_s>, then read logcat.
# t_ready = ActivityManager "Start proc" to GATT onSearchComplete (includes app start).
# The phone must already have its gun set (SET MY GUN), so a launch auto-connects.
# usage: coldconn.sh <adb-serial> <label> <runs> <hold_s> [out_dir]
# ADB overrides the adb binary (default: adb on PATH).
D=$1; L=$2; N=$3; H=$4; OUT=${5:-/tmp}; ADB=${ADB:-adb}; P=com.openbrx.companion
for i in $(seq 1 "$N"); do
  $ADB -s "$D" shell am force-stop $P; sleep 8
  $ADB -s "$D" logcat -c
  $ADB -s "$D" shell monkey -p $P -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep "$H"
  $ADB -s "$D" logcat -d -v epoch > "$OUT/cc-$L-$i.log"
  python3 - "$L" "$i" "$OUT/cc-$L-$i.log" <<'PY'
import sys,re
L,i,f=sys.argv[1:]; t0=tS=tC=None; disc=0; conns=0
for line in open(f,errors='ignore'):
    m=re.match(r'\s*(\d+\.\d+)',line)
    if not m: continue
    t=float(m.group(1))
    if t0 is None and 'Start proc' in line and 'com.openbrx.companion/' in line: t0=t
    if 'onClientConnectionState' in line:
        conns+=1
        if 'status=0' in line and tC is None: tC=t
        elif 'status=0' not in line: disc+=1
    if 'onSearchComplete' in line and tS is None: tS=t
ok = t0 is not None and tS is not None
print(f"{L} run {i}: {'ok' if ok else 'FAIL'} t_gatt={(tC-t0) if tC and t0 else float('nan'):.2f}s t_ready={(tS-t0) if ok else float('nan'):.2f}s conn_state_lines={conns} non0={disc}", flush=True)
PY
done
