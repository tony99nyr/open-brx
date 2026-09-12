"""IL2CPP global-metadata.dat parser (type/field/enum/attribute dump for the Requests.Headset classes).

Written 2026-09-04 by the APK-analysis agent to recover the BRX headset LED request layouts (MessageParameter
indices = token order, enum literal values, [Range] attributes) from callsign-base.apk (metadata v39). Usage: point
it at apk/assets/bin/Data/Managed/Metadata/global-metadata.dat (the path pass 1 opens, relative to the
working directory) extracted from ~/.brx-mcp/callsign-base.apk. Run il2cpp_meta.py first: this script imports it. Results are
in brx-protocol.md ($LED, $BLINK, $CHASE, $HLOOP, $HLED, $GLED, $BHIT, $IRTX, $HFIRE rows) and the 2026-09-04
experiment-log entry "HEADSET LED LAYOUTS READ FROM THE METADATA". Kept so the next question can be answered by
reading tables, not by guessing shapes on the bench.
"""
from il2cpp_meta import *
TO,TS,TC=T[19]; FO,FS,FC=T[11]; DO,DS,DC=T[7]; DDO,DDS,DDC=T[8]; MO,MS,MC=T[5]; PO,PS,PC=T[10]; PRO,PRS,PRC=T[4]; AO,AS,AC=T[24]; ARO,ARS,ARC=T[25]
def td(k):
    raw=b[TO+k*76:TO+k*76+76]; ints=struct.unpack_from('<19i',raw,0)
    return dict(idx=k,name=sname(ints[0]),ns=sname(ints[1]),parent=ints[3],flags=ints[4],fieldStart=ints[5],methodStart=ints[6],propertyStart=ints[8],method_count=ints[13]&0xffff,property_count=ints[13]>>16,field_count=ints[14]&0xffff,token=ints[18])
def field(i):
    raw=b[FO+i*10:FO+i*10+10]; n,t,tok=struct.unpack_from('<iHI',raw,0); return sname(n),t,tok
def method(i):
    raw=b[MO+i*30:MO+i*30+30]; n=struct.unpack_from('<i',raw,0)[0]; decl,ret=struct.unpack_from('<HH',raw,4); ps=struct.unpack_from('<i',raw,12)[0]; tok=struct.unpack_from('<I',raw,18)[0]; pc=struct.unpack_from('<H',raw,28)[0]; return sname(n),decl,ret,ps,pc,tok
def param(i):
    raw=b[PO+i*10:PO+i*10+10]; n,tok,t=struct.unpack_from('<iIH',raw,0); return sname(n),t
def prop(i):
    raw=b[PRO+i*20:PRO+i*20+20]; n,g,s,a,tok=struct.unpack_from('<5i',raw,0); return sname(n),g,s
dv={}
for i in range(DC):
    raw=b[DO+i*10:DO+i*10+10]; fi,t,di=struct.unpack_from('<iHi',raw,0); dv[fi]=di
def dec_at(base,di):
    b0=b[base+di]
    if b0<0x80: return b0>>1,1
    if b0<0xc0: return ((b0&0x3f)<<8|b[base+di+1])>>1,2
    if b0<0xe0: return (((b0&0x1f)<<24)|(b[base+di+1]<<16)|(b[base+di+2]<<8)|b[base+di+3])>>1,4
    return None,1
def dval(i): return dec_at(DDO,dv[i])[0] if i in dv else None
def show_type(k, methods=True):
    d=td(k)
    print('### %s.%s  (td %d, fields %d, methods %d, props %d)'%(d['ns'],d['name'],k,d['field_count'],d['method_count'],d['property_count']))
    for i in range(d['fieldStart'],d['fieldStart']+d['field_count']):
        n,t,tok=field(i); v=dval(i); print('   F %-28s type=%d tok=%#x%s'%(n,t,tok,(' ='+str(v)) if v is not None else ''))
    if methods:
        for i in range(d['methodStart'],d['methodStart']+d['method_count']):
            m=method(i); print('   M %-28s (%s)'%(m[0],', '.join('%s:%d'%param(p) for p in range(m[3],m[3]+m[4])) if m[3]>=0 else ''))
    if d['property_count']:
        for i in range(d['propertyStart'],d['propertyStart']+d['property_count']): print('   P',prop(i)[0])
attr={}
for i in range(ARC):
    tok,start=struct.unpack_from('<II',b,ARO+i*8); attr[tok]=start
