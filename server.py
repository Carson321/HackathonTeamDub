"""
StudyBrain v0.3 — Flask backend

Key changes from v0.2:
  - Fixed "Unterminated string" JSON error: max_tokens raised to 4000, Gemini forced
    to JSON mode via response_mime_type, retry logic for Anthropic
  - Tutor prompt completely reworked: concept-explaining + Socratic hybrid, not pure questions
  - /api/ingest now returns extractedText alongside parsed data
  - /api/chat accepts courseworkContext and includes it in the tutor's system prompt
  - Mock auth endpoints for login/register flow (no real DB needed for demo)
"""

import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

try:
    from anthropic import Anthropic
except ImportError:
    Anthropic = None

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:
    genai = None
    genai_types = None

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

try:
    import docx as docx_lib
except ImportError:
    docx_lib = None


# =============================================================================
# CONFIG
# =============================================================================

load_dotenv()

ROOT = Path(__file__).parent
PUBLIC_DIR = ROOT / "public" if (ROOT / "public").exists() else ROOT

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
GOOGLE_API_KEY = (
    os.environ.get("GOOGLE_API_KEY", "").strip()
    or os.environ.get("GEMINI_API_KEY", "").strip()
)
GROQ_API_KEY = (
    os.environ.get("GROQ_API_KEY", "").strip()
    or os.environ.get("GROK_API_KEY", "").strip()
)
CLAUDE_MODEL   = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5")
GEMINI_MODEL   = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GROQ_MODEL     = (
    os.environ.get("GROQ_MODEL", "").strip()
    or os.environ.get("GROK_MODEL", "").strip()
    or "openai/gpt-oss-120b"
)
AI_PROVIDER    = os.environ.get("AI_PROVIDER", "").strip().lower()
if AI_PROVIDER == "grok":
    AI_PROVIDER = "groq"
if not AI_PROVIDER:
    if GROQ_API_KEY:
        AI_PROVIDER = "groq"
    elif GOOGLE_API_KEY:
        AI_PROVIDER = "google"
    else:
        AI_PROVIDER = "anthropic"

MAX_FILE_BYTES      = 10 * 1024 * 1024   # 10 MB
MAX_TEXT_CHARS      = 25_000             # ~6k tokens
ALLOWED_EXTENSIONS  = {".pdf", ".docx", ".txt", ".md"}

app = Flask(__name__, static_folder=None)

_anthropic_client = None
_google_client    = None
_groq_client      = None


def get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is None:
        if not ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY not set. Add it to .env and restart.")
        if Anthropic is None:
            raise RuntimeError("anthropic package not installed. Run: pip install anthropic")
        _anthropic_client = Anthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic_client


def get_google_client():
    global _google_client
    if _google_client is None:
        if not GOOGLE_API_KEY:
            raise RuntimeError("GOOGLE_API_KEY not set. Add it to .env and restart.")
        if genai is None:
            raise RuntimeError("google-genai package not installed. Run: pip install google-genai")
        _google_client = genai.Client(api_key=GOOGLE_API_KEY)
    return _google_client


def get_groq_client():
    global _groq_client
    if _groq_client is None:
        if not GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY not set. Add it to .env and restart.")
        if OpenAI is None:
            raise RuntimeError("openai package not installed. Run: pip install openai")
        _groq_client = OpenAI(api_key=GROQ_API_KEY, base_url="https://api.groq.com/openai/v1")
    return _groq_client


def _generate_google(system: str, contents: str, max_tokens: int, force_json: bool = False) -> str:
    client = get_google_client()
    config_kwargs = dict(
        system_instruction=system,
        max_output_tokens=max_tokens,
    )
    # response_mime_type="application/json" forces Gemini to always return valid JSON.
    # This completely prevents the "Unterminated string" JSON parse error.
    if force_json:
        config_kwargs["response_mime_type"] = "application/json"
    resp = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=genai_types.GenerateContentConfig(**config_kwargs),
    )
    return resp.text or ""


def _generate_anthropic(system: str, contents: str, max_tokens: int, force_json: bool = False) -> str:
    client = get_anthropic_client()
    if force_json:
        system += "\n\nReturn exactly one valid JSON object. Do not include markdown, code fences, comments, or trailing text."
    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": contents}],
    )
    return resp.content[0].text if resp.content else ""


def _generate_groq(system: str, contents: str, max_tokens: int, force_json: bool = False) -> str:
    client = get_groq_client()
    kwargs = {}
    if force_json:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(
        model=GROQ_MODEL,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": contents}
        ],
        **kwargs,
    )
    return resp.choices[0].message.content if resp.choices else ""


def generate_text(system: str, contents: str, max_tokens: int, force_json: bool = False) -> str:
    if AI_PROVIDER == "google":
        return _generate_google(system, contents, max_tokens, force_json)
    if AI_PROVIDER == "anthropic":
        return _generate_anthropic(system, contents, max_tokens, force_json)
    if AI_PROVIDER == "groq":
        return _generate_groq(system, contents, max_tokens, force_json)
    raise RuntimeError("AI_PROVIDER must be 'google', 'anthropic', or 'groq'.")


# =============================================================================
# PROMPTS
# =============================================================================

TUTOR_SYSTEM_PROMPT = """You are StudyBrain Tutor — an intelligent academic coach for college students.

## Your Core Goal
Help students UNDERSTAND material deeply, not just get past assignments. You are a guide and thinking partner, not an answer machine.

## What You CAN Do
- Explain concepts, definitions, and theories clearly when a student doesn't understand them
- Confirm correct reasoning: "Yes, that's right — here's WHY that works..."
- Identify specifically what's right and wrong in student reasoning
- Give worked examples or analogies using DIFFERENT problems than the student's homework
- Point the student toward which concept, formula, or framework applies to their problem
- Ask ONE focused question at a time to help them discover key insights
- Create practice quizzes — one question at a time, wait for the student's answer before proceeding
- Give feedback on essays or written work: structure, argument quality, gaps — but not rewrite it

## What You NEVER Do
- Complete a homework problem, exam question, or graded assignment for the student
- Write essays, lab reports, or projects on their behalf
- Give an answer when the student just demands it without showing any effort
- Give a step-by-step solution to the exact question they are submitting

## How to Respond in Different Situations

**Student doesn't understand a concept:**
→ Explain it clearly in 2-4 sentences. Use an analogy if helpful. Don't immediately pivot to questions.

**Student has partially correct reasoning:**
→ Acknowledge what's right first. Identify the specific gap. Then ask ONE question to bridge it.

**Student is stuck on a specific problem:**
→ Ask: "What have you tried so far?" Then identify which concept applies. Help them set up the approach without finishing it.

**Student asks for the answer directly:**
→ "I can't give you that directly, but let's figure out your approach together. What do you know about [key concept]?"

**Student shares their work for feedback:**
→ Give specific, actionable feedback on reasoning and method. Affirm what's correct. Flag what isn't, and explain why.

**Student wants a quiz:**
→ Ask one question. Wait. Evaluate their answer, then give the next question.

## Format Rules
- 2-5 sentences for most replies. Longer only when explaining a genuinely complex concept.
- Plain language first. Use technical terms only after the student uses them.
- Ask at most ONE question per message.
- No bullet-point lists in conversational replies — write naturally.
"""

INGEST_SYSTEM_PROMPT = """You extract structured course information from college coursework (syllabi, lecture notes, etc).

Return ONLY a valid JSON object — no markdown, no code fences, no commentary. Keep the JSON compact.

Schema:
{
  "code": "ECON 3251" or null,
  "name": "Intermediate Macroeconomics" or null,
  "chapters": [
    {"id": "ch-1", "title": "string", "topics": ["string", ...]}
  ],
  "gradingWeights": {"Exams": 60, "Homework": 30, "Participation": 10} or null
}

Rules:
- Use null when a field cannot be confidently inferred.
- Chapter ids must be "ch-1", "ch-2", etc. in order.
- MAX 15 chapters. If more exist, keep the most important ones.
- Topics are short phrases (2-4 words). MAX 3 topics per chapter.
- gradingWeights keys are category names, values are integer percentages that sum to 100.
- If you cannot find chapters, return "chapters": [].
- Produce the SMALLEST valid JSON that captures the essential structure."""

STUDY_MATERIALS_SYSTEM_PROMPT = """You create study materials from uploaded college coursework.

Return ONLY a valid JSON object — no markdown, no code fences, no commentary.

Schema:
{
  "title": "chapter title",
  "summary": "40-70 word chapter summary grounded in the uploaded material",
  "topics": ["short topic", "..."],
  "flashcards": [
    {"front": "term or concept", "back": "direct definition/explanation", "explanation": "fresh example or deeper explanation"}
  ],
  "multipleChoice": [
    {"question": "question text", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "why the correct option is right"}
  ],
  "shortAnswer": [
    {"question": "short answer prompt", "sampleAnswer": "what a strong answer should include"}
  ]
}

Rules:
- Match the provided chapter title exactly.
- Use the uploaded material as the source of truth.
- Create exactly 2 flashcards, 1 multiple-choice question, and 1 short-answer question.
- Multiple-choice questions must test concepts, not which chapter a topic belongs to.
- Multiple-choice options must be answer statements, not questions. Options must not contain question marks.
- Keep every string short and student-facing.
- Do not include generic instruction text like "Define what it is" or "connect it to the broader framework"."""


# =============================================================================
# STATIC FILES
# =============================================================================

@app.route("/")
def root():
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    safe_path = (PUBLIC_DIR / filename).resolve()
    if not str(safe_path).startswith(str(PUBLIC_DIR.resolve())):
        return jsonify({"error": "Not found"}), 404
    if not safe_path.exists():
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(PUBLIC_DIR, filename)


# =============================================================================
# /api/chat
# =============================================================================

@app.post("/api/chat")
def api_chat():
    data = request.get_json(silent=True) or {}
    user_msg = (data.get("message") or "").strip()
    if not user_msg:
        return jsonify({"error": "Empty message"}), 400

    course_code       = data.get("courseCode") or ""
    course_name       = data.get("courseName") or ""
    chapter_title     = data.get("chapterTitle") or ""
    chapter_topics    = data.get("chapterTopics") or []
    coursework_ctx    = (data.get("courseworkContext") or "").strip()
    history           = data.get("history") or []

    system = TUTOR_SYSTEM_PROMPT

    # Inject course/chapter context
    if course_code or chapter_title:
        lines = [
            f"\n\n## Current Session Context",
            f"Course: {course_code} — {course_name}",
            f"Chapter: {chapter_title}",
        ]
        if chapter_topics:
            lines.append(f"Topics covered: {', '.join(chapter_topics)}")
        system += "\n".join(lines)

    # Inject uploaded coursework text so the tutor has access to the actual materials
    if coursework_ctx:
        # Trim to prevent excessive tokens
        ctx_trimmed = coursework_ctx[:12_000]
        system += (
            "\n\n## Course Materials (from uploaded files)\n"
            "Use this material to give accurate, course-specific guidance. "
            "Never quote it verbatim as an 'answer' to a homework question.\n\n"
            + ctx_trimmed
        )

    # Build conversation
    messages = []
    for m in history:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            messages.append({"role": m["role"], "content": m["content"]})
    if not messages or messages[-1]["role"] != "user" or messages[-1]["content"] != user_msg:
        messages.append({"role": "user", "content": user_msg})

    conversation = "\n".join(f"{m['role']}: {m['content']}" for m in messages)

    try:
        reply = generate_text(system, conversation, max_tokens=600)
        return jsonify({"reply": reply})
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        print(f"[chat] AI error: {e}", file=sys.stderr)
        return jsonify({"error": f"AI error: {e}"}), 502


# =============================================================================
# /api/ingest
# =============================================================================

def _extract_text(file_storage) -> str:
    filename = file_storage.filename or ""
    ext = Path(filename).suffix.lower()

    if ext == ".pdf":
        if PdfReader is None:
            raise RuntimeError("pypdf not installed. Run: pip install pypdf")
        reader = PdfReader(file_storage.stream)
        return "\n".join((page.extract_text() or "") for page in reader.pages)

    if ext == ".docx":
        if docx_lib is None:
            raise RuntimeError("python-docx not installed. Run: pip install python-docx")
        document = docx_lib.Document(file_storage.stream)
        return "\n".join(p.text for p in document.paragraphs)

    if ext in (".txt", ".md"):
        return file_storage.stream.read().decode("utf-8", errors="replace")

    raise RuntimeError(f"Unsupported file type: {ext}")


def _try_parse_json(s: str) -> dict:
    """Strip code fences and parse JSON. Raises json.JSONDecodeError on failure."""
    s = s.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```\s*$", "", s)
    if not s.startswith("{"):
        start = s.find("{")
        end = s.rfind("}")
        if start >= 0 and end > start:
            s = s[start:end + 1]
    return json.loads(s)


def _repair_truncated_json(s: str) -> dict:
    """
    Best-effort repair of JSON truncated at the token limit.
    Handles the most common case: response cut off mid-string or mid-array.
    """
    s = s.strip()
    # Remove code fences if present
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```\s*$", "", s)

    # Remove trailing commas before attempting to close
    s = re.sub(r",\s*$", "", s)

    # Count unclosed structures and close them
    open_braces   = s.count('{') - s.count('}')
    open_brackets = s.count('[') - s.count(']')

    # If we're mid-string, close it first
    # A rough heuristic: odd number of unescaped quotes → close the string
    unescaped_quotes = len(re.findall(r'(?<!\\)"', s))
    if unescaped_quotes % 2 == 1:
        s += '"'

    # Remove trailing comma that would appear before a closing bracket/brace
    s = re.sub(r',(\s*[}\]])$', r'\1', s)

    # Close open arrays and objects in reverse order
    s += ']' * max(open_brackets, 0)
    s += '}' * max(open_braces, 0)

    return json.loads(s)


def _normalize_study_materials(data: dict, fallback_chapters: list[dict]) -> dict:
    chapters_in = data.get("chapters") if isinstance(data, dict) else []
    if not isinstance(chapters_in, list):
        chapters_in = []

    normalized = []
    fallback_titles = [str(ch.get("title") or "").strip() for ch in fallback_chapters if isinstance(ch, dict)]
    for idx, chapter in enumerate(chapters_in[:15]):
        if not isinstance(chapter, dict):
            continue
        title = str(chapter.get("title") or "").strip()
        if not title and idx < len(fallback_titles):
            title = fallback_titles[idx]
        if not title:
            continue

        topics = chapter.get("topics") if isinstance(chapter.get("topics"), list) else []
        topics = [str(t).strip() for t in topics if str(t).strip()][:8]

        flashcards = []
        for card in chapter.get("flashcards", []) if isinstance(chapter.get("flashcards"), list) else []:
            if not isinstance(card, dict):
                continue
            front = str(card.get("front") or "").strip()
            back = str(card.get("back") or "").strip()
            if front and back:
                flashcards.append({
                    "front": front[:160],
                    "back": back[:500],
                    "explanation": str(card.get("explanation") or "").strip()[:800],
                })
            if len(flashcards) >= 3:
                break

        multiple_choice = []
        seen_mc_questions = set()
        for q in chapter.get("multipleChoice", []) if isinstance(chapter.get("multipleChoice"), list) else []:
            if not isinstance(q, dict):
                continue
            question = str(q.get("question") or "").strip()
            options = q.get("options") if isinstance(q.get("options"), list) else []
            options = [str(o).strip() for o in options if str(o).strip()][:4]
            try:
                correct_index = int(q.get("correctIndex"))
            except (TypeError, ValueError):
                correct_index = 0
            key = re.sub(r"\s+", " ", question.lower()).strip()
            options_are_answers = all("?" not in option for option in options)
            if question and key not in seen_mc_questions and options_are_answers and len(options) == 4 and 0 <= correct_index < 4:
                seen_mc_questions.add(key)
                multiple_choice.append({
                    "question": question[:500],
                    "options": options,
                    "correctIndex": correct_index,
                    "explanation": str(q.get("explanation") or "").strip()[:800],
                })
            if len(multiple_choice) >= 2:
                break

        short_answer = []
        seen_short_questions = set()
        for q in chapter.get("shortAnswer", []) if isinstance(chapter.get("shortAnswer"), list) else []:
            if not isinstance(q, dict):
                continue
            question = str(q.get("question") or "").strip()
            sample = str(q.get("sampleAnswer") or "").strip()
            key = re.sub(r"\s+", " ", question.lower()).strip()
            if question and key not in seen_short_questions:
                seen_short_questions.add(key)
                short_answer.append({"question": question[:500], "sampleAnswer": sample[:800]})
            if len(short_answer) >= 2:
                break

        normalized.append({
            "title": title,
            "summary": str(chapter.get("summary") or "").strip()[:800],
            "topics": topics,
            "flashcards": flashcards,
            "multipleChoice": multiple_choice,
            "shortAnswer": short_answer,
        })

    return {"chapters": normalized}


def _fallback_study_materials(chapters: list[dict]) -> dict:
    fallback = []
    for chapter in chapters[:8]:
        if not isinstance(chapter, dict):
            continue
        title = str(chapter.get("title") or "").strip()
        if not title:
            continue
        topics = chapter.get("topics") if isinstance(chapter.get("topics"), list) else []
        topics = [str(t).strip() for t in topics if str(t).strip()][:3] or [title]
        flashcards = [
            {
                "front": topic,
                "back": f"{topic} is a key concept in {title}.",
                "explanation": f"Review how {topic} is used in the uploaded material for {title}.",
            }
            for topic in topics[:2]
        ]
        fallback.append({
            "title": title,
            "summary": f"Review the main ideas, definitions, and examples from {title}.",
            "topics": topics,
            "flashcards": flashcards,
            "multipleChoice": [],
            "shortAnswer": [
                {
                    "question": f"Explain one important idea from {title}.",
                    "sampleAnswer": "A strong answer should define the idea, explain why it matters, and connect it to an example from the uploaded material.",
                }
            ],
        })
    return {"chapters": fallback}


def _fallback_chapter_study_material(chapter: dict) -> dict:
    title = str(chapter.get("title") or "Chapter").strip()
    topics = chapter.get("topics") if isinstance(chapter.get("topics"), list) else []
    topics = [str(t).strip() for t in topics if str(t).strip()][:3] or [title]
    return {
        "title": title,
        "summary": f"Review the main ideas, definitions, and examples from {title}.",
        "topics": topics,
        "flashcards": [
            {
                "front": topic,
                "back": f"{topic} is a key concept in {title}.",
                "explanation": f"Review how {topic} is used in the uploaded material for {title}.",
            }
            for topic in topics[:2]
        ],
        "multipleChoice": [],
        "shortAnswer": [
            {
                "question": f"Explain one important idea from {title}.",
                "sampleAnswer": "Define the idea, explain why it matters, and connect it to an example from the uploaded material.",
            }
        ],
    }


def generate_study_materials(course_code: str, course_name: str, chapters: list[dict], text: str) -> dict:
    generated = []
    usable_chapters = [ch for ch in chapters[:8] if isinstance(ch, dict) and str(ch.get("title") or "").strip()]
    if not usable_chapters:
        usable_chapters = [{"title": "Uploaded Coursework", "topics": []}]

    for chapter in usable_chapters:
        title = str(chapter.get("title") or "Chapter").strip()
        topics = chapter.get("topics") if isinstance(chapter.get("topics"), list) else []
        topic_text = ", ".join(str(t).strip() for t in topics if str(t).strip())
        prompt = (
            f"Course: {course_code or 'Unknown'} — {course_name or 'Unknown'}\n"
            f"Chapter title: {title}\n"
            f"Known topics: {topic_text or 'Infer from the uploaded text'}\n\n"
            "Create study materials for this chapter only. Return one JSON object matching the schema.\n\n"
            "Uploaded coursework text:\n"
            + text[:10_000]
        )
        try:
            raw = generate_text(STUDY_MATERIALS_SYSTEM_PROMPT, prompt, max_tokens=1200, force_json=True)
            parsed = _try_parse_json(raw)
            normalized = _normalize_study_materials({"chapters": [parsed]}, [chapter])
            generated.append(normalized["chapters"][0] if normalized["chapters"] else _fallback_chapter_study_material(chapter))
        except Exception as e:
            print(f"[ingest] Study materials failed for chapter '{title}': {e}", file=sys.stderr)
            generated.append(_fallback_chapter_study_material(chapter))

    return {"chapters": generated}


@app.post("/api/ingest")
def api_ingest():
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files uploaded"}), 400

    combined_parts = []
    for f in files:
        ext = Path(f.filename or "").suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            return jsonify({"error": f"Unsupported file type: {ext}"}), 400

        f.stream.seek(0, 2); size = f.stream.tell(); f.stream.seek(0)
        if size > MAX_FILE_BYTES:
            return jsonify({"error": f"{f.filename} exceeds 10 MB limit"}), 400

        try:
            text = _extract_text(f)
        except Exception as e:
            return jsonify({"error": f"Could not parse {f.filename}: {e}"}), 400

        text = text.strip()
        if text:
            combined_parts.append(f"=== {f.filename} ===\n{text}")

    if not combined_parts:
        return jsonify({
            "error": "No readable text found. Scanned (image-based) PDFs are not supported."
        }), 400

    # Keep the combined text for storage in the frontend
    full_text = "\n\n".join(combined_parts)

    # Truncate for the AI call
    ai_text = full_text[:MAX_TEXT_CHARS]
    if len(full_text) > MAX_TEXT_CHARS:
        ai_text += "\n\n[truncated]"

    raw = ""
    try:
        # force_json=True makes Gemini always return valid JSON — prevents truncation errors
        raw = generate_text(INGEST_SYSTEM_PROMPT, ai_text, max_tokens=4000, force_json=True)
        parsed = _try_parse_json(raw)
    except json.JSONDecodeError as e1:
        print(f"[ingest] JSON parse error (first attempt): {e1}\nRaw[:300]: {raw[:300]}", file=sys.stderr)

        # Attempt 1: try to repair the truncated JSON
        try:
            parsed = _repair_truncated_json(raw)
            print("[ingest] Repaired truncated JSON successfully.", file=sys.stderr)
        except Exception:
            # Attempt 2: retry AI with an explicit "be very concise" instruction
            try:
                short_prompt = (
                    "Extract ONLY the course code, name, and first 5 chapters as JSON. "
                    "Keep it extremely short. No topics. No gradingWeights.\n\n" + ai_text[:8000]
                )
                raw2 = generate_text(INGEST_SYSTEM_PROMPT, short_prompt, max_tokens=800, force_json=True)
                parsed = _try_parse_json(raw2)
                print("[ingest] Retry succeeded.", file=sys.stderr)
            except Exception as e2:
                print(f"[ingest] Retry also failed: {e2}", file=sys.stderr)
                return jsonify({
                    "error": "Could not parse AI response as JSON after two attempts. Try a shorter or simpler file."
                }), 502
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        print(f"[ingest] AI API error: {e}", file=sys.stderr)
        return jsonify({"error": f"Parse failed: {e}"}), 502

    # Return parsed data + extracted text (frontend stores text for chat context)
    # Truncate stored text to keep localStorage manageable (~5k chars per file)
    stored_text = full_text[:5_000]
    parsed["extractedText"] = stored_text
    try:
        parsed["studyMaterials"] = generate_study_materials(
            parsed.get("code") or "",
            parsed.get("name") or "",
            parsed.get("chapters") or [],
            ai_text,
        )
    except Exception as e:
        print(f"[ingest] Study material generation failed: {e}", file=sys.stderr)
        parsed["studyMaterials"] = {"chapters": []}
        parsed["studyMaterialsError"] = str(e)
    return jsonify(parsed)


# =============================================================================
# MOCK AUTH — /api/register and /api/login
# No real DB: just validate inputs and return a user object.
# The frontend stores everything in localStorage. This is demo-only.
# =============================================================================

@app.post("/api/register")
def api_register():
    data = request.get_json(silent=True) or {}
    name  = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    # password field accepted but not validated or stored — demo only
    if not name or not email or "@" not in email:
        return jsonify({"error": "Name and a valid email are required."}), 400
    # Derive initials
    parts    = name.split()
    initials = (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()
    return jsonify({"ok": True, "user": {"name": name, "email": email, "initials": initials}})


@app.post("/api/login")
def api_login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return jsonify({"error": "A valid email is required."}), 400
    # In a real app: look up user in DB and verify password.
    # For demo: accept any email, derive a name from it.
    name_guess = email.split("@")[0].replace(".", " ").replace("_", " ").title()
    parts      = name_guess.split()
    initials   = (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()
    return jsonify({"ok": True, "user": {"name": name_guess, "email": email, "initials": initials}})


# =============================================================================
# HEALTH
# =============================================================================

@app.get("/api/health")
def health():
    if AI_PROVIDER == "google":
        configured = bool(GOOGLE_API_KEY)
        model = GEMINI_MODEL
    elif AI_PROVIDER == "groq":
        configured = bool(GROQ_API_KEY)
        model = GROQ_MODEL
    else:
        configured = bool(ANTHROPIC_API_KEY)
        model = CLAUDE_MODEL
    return jsonify({
        "ok": True,
        "provider": AI_PROVIDER,
        "api_key_configured": configured,
        "model": model,
    })


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print()
    print("=" * 60)
    print("StudyBrain v0.3")
    print(f"  http://localhost:{port}")
    print(f"  Provider : {AI_PROVIDER}")
    if AI_PROVIDER == "google":
        model = GEMINI_MODEL
        configured = bool(GOOGLE_API_KEY)
    elif AI_PROVIDER == "groq":
        model = GROQ_MODEL
        configured = bool(GROQ_API_KEY)
    else:
        model = CLAUDE_MODEL
        configured = bool(ANTHROPIC_API_KEY)
    print(f"  Model    : {model}")
    print(f"  API key  : {'✓ configured' if configured else '✗ MISSING'}")
    if not configured:
        if AI_PROVIDER == "google":
            key_name = "GOOGLE_API_KEY"
        elif AI_PROVIDER == "groq":
            key_name = "GROQ_API_KEY"
        else:
            key_name = "ANTHROPIC_API_KEY"
        print(f"\n  ⚠  Add {key_name} to your .env file and restart.")
    print("=" * 60)
    print()
    app.run(host="0.0.0.0", port=port, debug=True)
