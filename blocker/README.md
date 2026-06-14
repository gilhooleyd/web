# Web Blocker Chrome Extension

This extension helps limit time spent on specific websites during the day.

## Features
- Block specific websites with daily time limits (configured in settings).
- Track access attempts and time spent per website.
- Landing page showing daily stats, weekly usage graph, and yearly activity heatmap.
- "Visit Site" bypass:
  - If time remains: simple click.
  - If no time remains: requires solving a math puzzle (addition of two 4-bit numbers).
- In-page info box showing time remaining or total time spent, with a "Back" button to return to the landing page.

## Installation

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** (button in the top-left corner).
4. Select the `blocker` directory containing these files.

## Usage

1. **Configure Settings**:
   - Right-click the extension icon and select **Options**, or click "Details" on the extension card in `chrome://extensions/` and click "Extension options".
   - Add domains you want to block (e.g., `reddit.com`, `youtube.com`) and set a daily limit in minutes.
2. **Browsing**:
   - When you visit a blocked site, you will be redirected to the landing page.
   - Click "Visit Site" to proceed.
   - Once on the site, you will see a floating info box in the top-left corner.
   - Click "Back" in the info box to return to the landing page.
