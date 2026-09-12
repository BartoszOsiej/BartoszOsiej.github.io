#!/usr/bin/env python3
"""
spotify-auth-helper.py — one-time Spotify authorization for bartoszosiej.github.io
═══════════════════════════════════════════════════════════════════════════════════
Run this ONCE on your local machine. It:

  1. Opens Spotify's authorization page (you log in and click "Agree").
  2. You paste the redirected URL back here.
  3. It exchanges the code for a REFRESH TOKEN (never expires unless you revoke).
  4. It prints the exact `gh secret set` commands to run next.

Requirements: Python 3.8+, requests (pip install requests), gh CLI logged in
              (gh auth login) so you can set the repo secrets.

Usage:
    python3 scripts/spotify-auth-helper.py
"""

import base64
import sys
import urllib.parse
import webbrowser

import requests

# ─── Constants ────────────────────────────────────────────────────────────────
AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
REDIRECT_URI = "http://127.0.0.1:8899/callback"  # matches the Spotify app settings
SCOPES = "user-read-currently-playing user-read-playback-state"


def main() -> int:
    print("═" * 78)
    print("SPOTIFY ONE-TIME AUTH — The Stitcher root site / Now Playing module")
    print("═" * 78)

    client_id = input("\n1. Paste your SPOTIFY_CLIENT_ID: ").strip()
    client_secret = input("2. Paste your SPOTIFY_CLIENT_SECRET: ").strip()
    if not client_id or not client_secret:
        print("Both values are required. Get them from https://developer.spotify.com/dashboard")
        return 1

    # ── Step 1: authorization URL ──
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
    }
    url = AUTH_URL + "?" + urllib.parse.urlencode(params)

    print("\n3. Opening browser for Spotify authorization…")
    print("   (if it doesn't open, paste this into your browser manually):\n")
    print(url, "\n")
    try:
        webbrowser.open(url)
    except Exception:
        pass

    # ── Step 2: user pastes the redirect ──
    redirected = input(
        f"4. After clicking AGREE you'll land on a page that fails to load\n"
        f"   ({REDIRECT_URI} is not a real server — that's fine).\n"
        f"   Copy the FULL URL from the browser address bar and paste it here: "
    ).strip()

    qs = urllib.parse.urlparse(redirected).query
    code_values = urllib.parse.parse_qs(qs).get("code")
    if not code_values:
        print("ERROR: no 'code' parameter in that URL. Did you paste the whole address?")
        return 1
    code = code_values[0]

    # ── Step 3: exchange for tokens ──
    print("\n5. Exchanging authorization code for tokens…")
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    resp = requests.post(
        TOKEN_URL,
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
        },
        timeout=30,
    )
    if resp.status_code != 200:
        print(f"ERROR: token exchange failed: {resp.status_code}\n{resp.text}")
        return 1

    tokens = resp.json()
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        print("ERROR: no refresh_token in response — did you request the right scopes?")
        return 1

    print("   ✓ Got refresh token (it does not expire unless you revoke access).")

    # ── Step 4: print gh secret set commands ──
    print("\n" + "═" * 78)
    print("DONE. Now run these three commands to store the secrets in the repo:")
    print("═" * 78)
    print(f"""
gh secret set SPOTIFY_CLIENT_ID     -R BartoszOsiej/BartoszOsiej.github.io -b "{client_id}"
gh secret set SPOTIFY_CLIENT_SECRET -R BartoszOsiej/BartoszOsiej.github.io -b "{client_secret}"
gh secret set SPOTIFY_REFRESH_TOKEN -R BartoszOsiej/BartoszOsiej.github.io -b "{refresh_token}"
""")
    print("After that the GitHub Action (refresh-spotify.yml) takes over — it refreshes")
    print("the token and publishes your current track to now-playing.json every 5 minutes.")
    print("No Discord, no third-party service.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
