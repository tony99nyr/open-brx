#!/bin/bash
# Bootstrap a fresh MacBook with Tony's shell environment.
# Idempotent — safe to re-run. Run from the repo root:  bash dotfiles/setup-mac.sh
set -euo pipefail

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

# --- Homebrew ---------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  say "Installing Homebrew (will prompt for your password)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
else
  say "Homebrew already installed"
fi

say "Installing CLI tools (git, gh, git-lfs, bat, pnpm, python)"
brew install git gh git-lfs bat pnpm python@3.13 || true
git lfs install

# --- oh-my-zsh + plugins ----------------------------------------------------
if [ ! -d "$HOME/.oh-my-zsh" ]; then
  say "Installing oh-my-zsh"
  RUNZSH=no KEEP_ZSHRC=yes sh -c \
    "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
else
  say "oh-my-zsh already installed"
fi

ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
clone_plugin() {
  local name="$1" url="$2"
  if [ ! -d "$ZSH_CUSTOM/plugins/$name" ]; then
    say "Installing zsh plugin: $name"
    git clone --depth 1 "$url" "$ZSH_CUSTOM/plugins/$name"
  fi
}
clone_plugin zsh-autosuggestions    https://github.com/zsh-users/zsh-autosuggestions
clone_plugin zsh-syntax-highlighting https://github.com/zsh-users/zsh-syntax-highlighting
clone_plugin you-should-use         https://github.com/MichaelAquilina/zsh-you-should-use
clone_plugin zsh-bat                https://github.com/fdellwing/zsh-bat
clone_plugin zsh-nvm                https://github.com/lukechilds/zsh-nvm

# --- zshrc ------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$HOME/.zshrc" ] && ! grep -q 'macOS port of the WSL config' "$HOME/.zshrc"; then
  say "Backing up existing ~/.zshrc to ~/.zshrc.pre-setup"
  cp "$HOME/.zshrc" "$HOME/.zshrc.pre-setup"
fi
cp "$SCRIPT_DIR/zshrc.macos" "$HOME/.zshrc"
say "Wrote ~/.zshrc"

# --- git config -------------------------------------------------------------
say "Configuring git"
git config --global user.name  "tony99nyr"
git config --global user.email "tony@iamrossi.com"
git config --global --replace-all credential.helper osxkeychain
git config --global 'credential.https://github.com.helper' '!gh auth git-credential'
git config --global 'credential.https://gist.github.com.helper' '!gh auth git-credential'

# --- node via nvm (zsh-nvm auto-installs nvm on first shell) ----------------
say "Node: zsh-nvm installs nvm on first new shell; then run: nvm install 24"

say "Done. Remaining manual steps:"
echo "  1. gh auth login          # browser-based GitHub auth (no tokens in dotfiles!)"
echo "  2. open a new terminal    # loads oh-my-zsh + plugins"
echo "  3. nvm install 24         # match node v24 from the WSL machine"
