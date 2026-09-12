"""IL2CPP global-metadata.dat parser (first pass: table offsets + string calibration).

Written 2026-09-04 by the APK-analysis agent to recover the BRX headset LED request layouts (MessageParameter
indices = token order, enum literal values, [Range] attributes) from callsign-base.apk (metadata v39). Usage: point
it at apk/assets/bin/Data/Managed/Metadata/global-metadata.dat (the path it opens, relative to the working
directory) extracted from ~/.brx-mcp/callsign-base.apk. Results are
in brx-protocol.md ($LED, $BLINK, $CHASE, $HLOOP, $HLED, $GLED, $BHIT, $IRTX, $HFIRE rows) and the 2026-09-04
experiment-log entry "HEADSET LED LAYOUTS READ FROM THE METADATA". Kept so the next question can be answered by
reading tables, not by guessing shapes on the bench.
"""
import struct,sys
b=open('apk/assets/bin/Data/Managed/Metadata/global-metadata.dat','rb').read()
h=struct.unpack_from('<95i',b,0)
T={k:h[2+3*k:5+3*k] for k in range(31)}
soff,ssize,scount=T[2]
blob=b[soff:soff+ssize]
def sname(o):
    if 0<=o<ssize:
        j=blob.find(b'\0',o); return blob[o:j].decode('utf-8','replace')
    return '?%d'%o
strs=[];offs=[]
i=0
while i<ssize:
    j=blob.index(b'\0',i); strs.append(blob[i:j].decode('utf-8','replace')); offs.append(i); i=j+1
first={}
for k,s in enumerate(strs): first.setdefault(s,offs[k])
def hits(val):
    tb=struct.pack('<i',val); pos=0; out=[]
    while True:
        pos=b.find(tb,pos)
        if pos<0: break
        for k,(o,s,c) in T.items():
            if o<=pos<o+s: out.append((k,pos-o,(pos-o)%(s//c if c else 1))); break
        pos+=1
    return out
