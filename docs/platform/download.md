# Download
Last verified: 2026-11-22

The BRX Companion is the phone app that rides each tagger. Mission Control and brx-mcp are one Python package for the laptop.

## Android

Get the current build below.

```data
download
```

1. When Android warns about installing from outside the Play Store, allow it from the browser or Files app that downloaded the APK.
2. Open the downloaded file to install it.
3. Grant the permission the app asks for. On Android 12 and later it is Nearby devices (Bluetooth). On Android 11 and older it is Location, and Location must also be turned on: those versions cannot scan for Bluetooth devices without it.

The build is release-signed by Open BRX but does not come from the Play Store, so Android shows its usual warning for an app from outside the store.

## iOS

There is no App Store or TestFlight build. iOS runs the same app, built from source with Xcode on a Mac, and it needs iOS 16.2 or later. The steps are in the repository's [`app/README.md`](https://github.com/tony99nyr/open-brx/blob/main/app/README.md), section *To build for iOS*.

## Laptop

```
git clone https://github.com/tony99nyr/open-brx
cd open-brx
./start.sh
```

On Windows, run `start.cmd` instead. The script sets everything up and starts Mission Control. See
[Install](/docs/install/) for what it does, and for the manual path if you would rather install
Python and Node.js yourself.
