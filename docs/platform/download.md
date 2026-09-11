# Download
Last verified: 2026-09-11

The BRX Companion is the phone app that rides each tagger. Mission Control and brx-mcp are one Python package for the laptop.

## Android

Get the current build below.

```data
download
```

1. When Android warns about installing from outside the Play Store, allow it from the browser or Files app that downloaded the APK.
2. Open the downloaded file to install it.
3. Grant Bluetooth and location when the app asks. Android needs both for BLE scanning.

The build is signed with Android's debug key today, so Android shows its usual warning for an app that is not from the Play Store.

## iOS

There is no App Store or TestFlight build. iOS runs the same app, built from source with Xcode on a Mac. See [Install](/docs/install/) and the repository's [`app/README.md`](https://github.com/tony99nyr/open-brx/blob/main/app/README.md).

## Laptop

```
pip install -e ./mcp
python -m brx_mcp.mc
```

See [Install](/docs/install/) for the rest.
