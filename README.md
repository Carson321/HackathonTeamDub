# StudyBrain

AI study app. HTML / CSS / JS frontend served by a Python Flask backend that proxies the Claude API.

---

5th place submission for Mizzou Claude Builders Club Hackathon 2026.

## ⚠️ READ THIS FIRST: How to actually run this

**This app has a backend. You MUST run it as a Python server.** If you try to open `index.html` directly in the browser (`file://...`), or use VS Code's "Live Server" extension, or `python -m http.server`, **the chat and upload features will fail with HTTP 405**.

Here is the only correct way to run it:

```bash
cd studybrain
python server.py
```

Then visit **http://localhost:5000** in your browser.

If you see this in your terminal, the server is running correctly:

```
============================================================
StudyBrain server
  http://localhost:5000
  Model: claude-sonnet-4-5
  API key configured: True
============================================================
```

If chat or upload still fail after that, check the terminal where you ran `python server.py` for the actual error message.

---

## First-time setup (do this once)

### 1. Make sure Python is installed

```bash
python --version    # should print 3.10 or higher
```

If `python` doesn't work, try `python3` instead. On Windows you may need to install Python from python.org first.

### 2. Open a terminal and `cd` into the project folder

```bash
cd path/to/studybrain
```

### 3. Create a virtual environment (keeps dependencies isolated)

```bash
# Mac / Linux
python -m venv .venv
source .venv/bin/activate

# Windows (PowerShell)
python -m venv .venv
.venv\Scripts\Activate.ps1

# Windows (cmd.exe)
python -m venv .venv
.venv\Scripts\activate.bat
```

After this, your terminal prompt should show `(.venv)` at the start. That means it's working.

### 4. Install dependencies

```bash
pip install -r requirements.txt
```

This installs Flask, the Anthropic SDK, pypdf (for PDF parsing), and python-docx (for Word doc parsing).

### 5. Get a Claude API key

1. Go to https://console.anthropic.com
2. Sign up or log in
3. Click "API Keys" in the left sidebar
4. Click "Create Key"
5. Copy the key — it starts with `sk-ant-`

### 6. Create your `.env` file

```bash
# Mac / Linux
cp .env.example .env

# Windows
copy .env.example .env
```

Open `.env` in any text editor and replace the placeholder with your real key:

```
ANTHROPIC_API_KEY=sk-ant-api03-your-real-key-here
```

**Save and close the file.** Never commit `.env` to GitHub. The `.gitignore` already excludes it.

---

## Running the app (every time)

Open a terminal in the project folder, then:

```bash
# 1. Activate the virtual environment (skip if already active)
source .venv/bin/activate         # Mac/Linux
.venv\Scripts\activate            # Windows

# 2. Run the server
python server.py
```

Visit **http://localhost:5000**.

To stop the server, press **Ctrl+C** in the terminal.

---

## Project structure

```
studybrain/
├── server.py              ← Flask backend (run this)
├── requirements.txt       ← Python dependencies
├── .env                   ← Your API key (you create this)
├── .env.example           ← Template
├── .gitignore             ← Excludes .env and node_modules
├── README.md              ← This file
└── public/
    ├── index.html         ← Markup only
    ├── style.css          ← All styles
    └── app.js             ← All frontend logic
```

---

## Features

| Feature | How to use |
|---|---|
| **Add a course** | Click "Add class" on the dashboard |
| **Edit a course** (grade, weights, scale, delete) | Hover any course card and click the pencil icon |
| **Add a chapter manually** | Click "+ Add" next to "Chapters" in the sidebar |
| **Delete a chapter** | Hover any chapter row and click the ✕ |
| **Upload a syllabus** | Click "Upload coursework" — review the AI's extraction before applying |
| **Delete uploaded coursework** | Click the ✕ next to any file in the Coursework section |
| **Change grade manually** | Edit course → check "Set manually" → enter percentage and letter |
| **Grade from weights** | Edit course → leave "Set manually" unchecked → fill in weights and earned scores |
| **Adjust grade scale** | Edit course → expand "Grade scale (advanced)" |
| **Toggle what shows on cards** | Click Settings (top right) → toggle percentage/letter/chapter count |
| **Reset everything** | Click Settings → Reset all data (at the bottom) |

---

## Common errors and what they mean

### "Upload failed: HTTP 405" / "Tutor unreachable: HTTP 405"

**Cause:** You're not running `python server.py`. You're probably using VS Code Live Server (port 5500) or `python -m http.server` (port 8000) — both of those only serve static files, they don't have the `/api/chat` or `/api/ingest` routes.

**Fix:** Stop whatever you're running, then in a terminal:
```bash
cd studybrain
python server.py
```
Visit **http://localhost:5000** (NOT 5500 or 8000).

### "Cannot reach backend"

**Cause:** Server isn't running, or you're at the wrong URL.

**Fix:** Run `python server.py`. Make sure you're at `http://localhost:5000`.

### "Claude API key missing or invalid"

**Cause:** No `.env` file, or the key in it is wrong.

**Fix:** Check that `.env` exists in the project root and contains a valid key starting with `sk-ant-`. Restart the server after editing `.env`.

### "Could not parse [filename]"

**Cause:** The file is unsupported, corrupted, or a scanned PDF (image-based, not text).

**Fix:** Try a `.docx`, a text-based PDF, or paste the syllabus into a `.txt` file.

### "Address already in use" / "Port 5000 already in use"

**Cause:** Another process is using port 5000. On macOS, AirPlay Receiver uses it by default.

**Fix:** Either disable AirPlay Receiver in System Settings → General → AirDrop & Handoff, or run on a different port:
```bash
PORT=5050 python server.py    # Mac/Linux
$env:PORT="5050"; python server.py    # Windows PowerShell
```
Then visit `http://localhost:5050`.

### Page loads but nothing is interactive

**Cause:** A JavaScript error. Open DevTools (F12) and look at the Console tab — it'll tell you exactly what went wrong.

---

## Architecture

```
Browser ──fetch()──▶ Flask (server.py) ──Anthropic SDK──▶ Claude API
   ▲                       │
   └────── JSON ◀──────────┘
```

The browser never talks to Anthropic directly. Your API key stays on the server. Your course data lives in the browser's `localStorage`.

### Endpoints

| Method | Path | What it does |
|---|---|---|
| `GET`  | `/` | Serves `public/index.html` |
| `GET`  | `/<file>` | Serves any file in `public/` |
| `POST` | `/api/chat` | Sends a Socratic tutor message |
| `POST` | `/api/ingest` | Parses uploaded syllabus/notes, returns structured data |
| `GET`  | `/api/health` | Tells you if the server and API key are ready |


