# Custom sounds over USB
_Yes, you can put your own audio on a BRX. No firmware hacking, and fully reversible_
Last verified: 2026-08-27

## The AUDIO folder.
Hold SELECT while you power on with a USB cable attached, and the tagger becomes a disk drive. You get a firmware file at the root and an `AUDIO` folder of per-sound files: replace a file, replace a sound. This is Battle Company's own update path, confirmed in their Extended User Guide, and the community has used it for Star Wars packs for years.
Source: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

## Back up the whole `AUDIO` folder before you change anything.
The originals belong to Battle Company, and the factory restore is their USB updater package (see Firmware updates). Copying files is slow, so budget up to an hour per 250 MB. Don't unplug early.
Source: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

## Swap a sound
1. Power the tagger **off**, then connect the micro-USB **Programming Port** (not the charging port) to a computer. 📖
2. **Hold SELECT and switch the gun on.** It makes no startup sound, and that silence is how you know you are in disk mode. A normal power-on never exposes the drive. 📖👥
3. Open the removable disk that appears (Windows or macOS), with a `.BIN` at the root and an **`AUDIO`** folder. On older non-logo guns, tap SELECT a few times after entering if nothing shows. 📖
4. Copy the entire `AUDIO` folder to your computer as a backup. 👥
5. Name your replacement file **`<ID>.LTP`**, using the sound id from the bank (e.g. `R02.LTP` replaces the M4 fire sound, `NA0.LTP` the death beep). 👥
6. Drag it into `AUDIO`, choose **overwrite = yes**, and wait for the copy to finish. 📖
7. Eject the disk, power-cycle, and test with the on-gun menu (or `$PLAY,<id>,4,6,,,,,*` over Bluetooth). ✅
Source: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, protocol/callsign-extract/sound-bank.md

## File facts
- **Naming:** `<ID>.LTP`, one file per bank id. Known community swaps: `NA0.ltp` death loud-beep, `VA3.ltp` scream, `VA5.ltp` yell (copy or rename one over another to change the death cue).
- **Which files are which weapon:** the Callsign-app gun sounds use **different file names from the default (on-gun menu) weapon files**. Replacing one set won't change the other. Default guns to target for the menu game: SR-100, TAC-87, SMG-x3, MG7.
- **Firmware v4.30+ needs a complete new audio-file set** in `AUDIO`. After that update, old packs don't line up.
Source: docs/reference/community-notes.md · docs/reference/community-notes.md · docs/reference/community-notes.md

## What people build with this
- **Full overlay packs**: a complete Star Wars sound set exists in the owner community (credit David Knox). It replaces weapon, hit and voice files wholesale. 👥
- **Re-skinning the "reflex" sounds**: the "phone connected" line, the disabled chirp, low-battery. You can't stop them, but you can make them yours (Open BRX plans an "Open BRX connected" line this way). ✅
- **Grenade audio**: the explosion, flashbang, gas and CTF music you hear from a grenade are gun-bank files (`X`/`H`/`JA` families). Swap those and every grenade "sounds different", with zero grenade modification. ✅👥
Source: docs/reference/community-notes.md, docs/sound-architecture.md, docs/FOLLOWUPS.md B11, docs/reference/grenade.md

## Policy note.
Swapping files in `AUDIO` changes stored *content*, not firmware. It is the same mechanism Battle Company's updater uses, and it is reversible. Open BRX's own hard rule is "never modify stock firmware", and sound swaps sit comfortably inside it.
Source: CLAUDE.md, docs/reference/community-notes.md

_[image SND-04: REAL PHOTO: the tagger in USB disk mode next to a laptop showing the root `.BIN` and the `AUDIO` folder listing.]_
