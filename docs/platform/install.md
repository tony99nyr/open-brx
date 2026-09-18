# Install
Last verified: 2026-09-18

## What you need

- A laptop for Mission Control (Windows, macOS or Linux). It does not need Bluetooth: it talks to
  phones over Wi-Fi.
- A laptop with a Bluetooth radio (Windows, macOS or Linux), for `brx-mcp` and for arming taggers at
  the bench. This can be the same laptop as Mission Control.
- Git, to clone the repository. No git? See *Without git* below.
- One Android phone per player, for the Companion app. iOS builds from source.

The start script below installs Node.js and Python for you if either is missing. Use the manual
path further down if you would rather install them yourself.

## Quick start

```
git clone https://github.com/tony99nyr/open-brx
cd open-brx
./start.sh
```

On Windows, double-click `start.cmd` in the folder, or run `.\start.cmd` in PowerShell.

First, the script makes sure Node.js 20.11 or later is installed. If it is missing, the script offers
to install it (Homebrew on a Mac, winget on Windows). Then it prints five numbered steps:

1. It checks GitHub for a newer version and offers to update. It skips this when the folder has
   changes of its own, or there is no internet.
2. It finds Python 3.11 or later, or offers to install it the same way. Then it creates a `.venv`
   folder and installs the Mission Control package into it.
3. It installs and builds the Mission Control console, the web page you open in your browser.
4. It asks once whether to install the optional `cloudflared` tool, for reaching phones over the
   internet. The default answer is no. It remembers your answer in `~/.brx-mcp/start.json`.
5. It starts Mission Control and opens it in your browser.

Run the script again for every match. It skips every step it already did.

On Debian or Ubuntu, install `python3-venv` first: `sudo apt install python3-venv`. Step 2 needs it
to create the `.venv` folder.

### Without git

On the [GitHub page](https://github.com/tony99nyr/open-brx), click the green **Code** button, then
**Download ZIP**. Unzip it. On Windows, double-click `start.cmd` in the unzipped folder. On macOS or
Linux, open a terminal in the unzipped folder and run:

```
sh start.sh
```

The script cannot update a download: to get a newer version, download it again. To install git instead, see
[git-scm.com](https://git-scm.com/downloads).

### Useful flags

- `--demo` runs a demo instead: 8 pretend players and phones, no taggers, nothing saved.
- `--setup-only` sets everything up, then stops instead of starting Mission Control.
- `--no-update` skips the GitHub update check.
- `--yes` accepts the default answer to every question, for an unattended run. It never deletes a
  broken `.venv` folder: it stops and asks you to delete it.
- `--cloudflared` asks about `cloudflared` again, even if you said no before.
- `--help` prints all the options.

Anything after `--` goes to Mission Control itself, for example `./start.sh -- --port 9000`.

## The manual path

Use this if you manage Node.js and Python yourself, or you only want the command line tools.

### Installing the Python package

From a clone of the repository:

```
python -m venv .venv
.venv/bin/python -m pip install -e './mcp[mc]'
```

Requires Python 3.11 or later. The `[mc]` extra adds the packages Mission Control needs
(`websockets`, `starlette`, `uvicorn`, `zeroconf`); leave it off if you only want the command line
tools and the MCP server.

Every command below runs through that same virtual environment's Python: `.venv/bin/python` on
macOS and Linux, `.venv\Scripts\python.exe` on Windows. Activate the venv first
(`source .venv/bin/activate`) if you would rather type a bare `python`.

### Building the console

**Build the web UI first, and again after every `git pull`.** Mission Control serves the console
from `webapp/mc/dist`, which is not in the repository and is not rebuilt for you:

```
cd webapp/mc && npm install && npm run build
```

Requires Node.js 20.11 or later. A page that says "UI not built" means this step was skipped. A
console that is missing a control you expect means the build is older than the code: rebuild, then
hard-reload the browser tab.

### Running Mission Control

```
.venv/bin/python -m brx_mcp.mc
```

The server prints its URL and an operator token on launch; open the link it prints, including the
`#tok=` part. A restart mints a new token. The URL is printed before the port is bound; if the page
never loads, another Mission Control is probably still holding the port, so stop it first.

For a no-hardware demo:

```
.venv/bin/python -m brx_mcp.mc --demo --fake-net
```

`--demo` seeds a roster of players and taggers; `--fake-net` simulates the phone nodes in memory, so
the demo needs no phones and no taggers.

`pnpm mc` starts Mission Control once the setup above is done. It skips the update, install and
`cloudflared` steps, but it still rebuilds an old console and checks that the ports are free.

### First contact with a tagger

```
.venv/bin/python -m brx_mcp scan
.venv/bin/python -m brx_mcp identify <address>
.venv/bin/python -m brx_mcp listen <address> [seconds]
```

`scan` finds every tagger in Bluetooth range. `diagnose` reads one tagger's firmware, ping latency
and battery; `identify` only confirms it answers and which generation it is. `listen` opens a
read-only console on a tagger's live traffic.

### The MCP server, for agents

```
.venv/bin/python -m brx_mcp
```

With no subcommand, `brx-mcp` runs as an MCP server over stdio, so an agent can drive the bench
directly: scan, connect, send, wait for events, read diagnostics, and panic.

## Reaching phones over the internet

Optional, and only needed for players whose phone has a data plan but no Wi-Fi. Reaching phones over
the internet needs `cloudflared` on the Mission Control laptop. The start script above offers to
install it for you; by hand it is `brew install cloudflared` on a Mac, or
`winget install Cloudflare.cloudflared` on Windows. No account is needed. See
[Running a match](/docs/run-a-game/).

## The Android app

Download the current build from [`/download/`](/download/), which also covers iOS.
