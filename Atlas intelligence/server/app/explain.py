"""The AI writer: plain words from measured facts, never new facts.

Two endpoints share one writer:

* ``POST /api/explain`` rewrites an Ask-the-City answer. The body carries the
  question, the intent the app detected and the evidence list the app
  gathered; the writer may only phrase those items.
* ``POST /api/ask`` answers a free question from a structured snapshot of
  the world the app sends (facts with their evidence class). The writer is
  told what the app knows right now and nothing else.

Both return ``{"text", "writer", "language"}``. Without an Anthropic key the
endpoints answer 503 and the app falls back to its template writer.
"""
from __future__ import annotations

import logging
from typing import Any, Literal, Protocol

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .config import settings

log = logging.getLogger("atlas.explain")

MODEL = "claude-opus-5-5"
MAX_FACTS = 60
MAX_STATEMENT = 400

Language = Literal["en", "hi"]


class Fact(BaseModel):
    id: str = ""
    classification: str = "derived"
    statement: str = Field(..., max_length=MAX_STATEMENT)
    value: float | str | None = None
    confidence: float | None = None
    source: str | None = None


class ExplainRequest(BaseModel):
    question: str = Field(..., max_length=500)
    intent: str = "help"
    evidence: list[Fact] = Field(default_factory=list, max_length=MAX_FACTS)
    language: Language = "en"


class AskRequest(BaseModel):
    question: str = Field(..., max_length=500)
    snapshot: list[Fact] = Field(default_factory=list, max_length=MAX_FACTS)
    language: Language = "en"


class WriterReply(BaseModel):
    text: str
    writer: str
    language: Language


LABELS = {
    "en": {"observed": "we saw", "derived": "we worked out", "predicted": "our model guesses", "simulated": "in the simulation"},
    "hi": {"observed": "हमने देखा", "derived": "हमने निकाला", "predicted": "मॉडल का अनुमान", "simulated": "सिमुलेशन में"},
}

SYSTEM = """You are the plain-words writer for Atlas Infinity, a live city map.

You receive a question and a numbered list of FACTS the app measured. Rules:
1. Use ONLY the facts. Never add a number, place, cause, time or advice that is not in the list. If the facts do not answer the question, say that in one short sentence and stop.
2. Write in very simple words a 12-year-old understands. Short sentences. No jargon, no technical words, no acronyms, no percentages written as decimals.
3. Keep each fact's label by starting its sentence with the tag given for it: "we saw" (observed), "we worked out" (derived), "our model guesses" (predicted), "in the simulation" (simulated). In Hindi use the Hindi tags given.
4. At most 90 words. No headings, no bullet points, no markdown.
5. Language: write in the language asked. For Hindi, use simple everyday Hindi in Devanagari script; keep road and place names as they are.
"""

SYSTEM_ASK = SYSTEM + """
This is a free question. The facts are a snapshot of what the app knows right now. If the question is about something the snapshot does not cover (for example a place, a time or a topic not listed), say plainly that the map does not know that right now, and mention one related fact if there is one.
"""


def _facts_block(facts: list[Fact], language: Language) -> str:
    tags = LABELS[language]
    lines = []
    for i, f in enumerate(facts, 1):
        tag = tags.get(f.classification, tags["derived"])
        conf = f" (confidence {round(f.confidence * 100)}%)" if f.confidence is not None else ""
        lines.append(f"{i}. [{f.classification} → say '{tag}'] {f.statement.strip()}{conf}")
    return "\n".join(lines) if lines else "(no facts)"


def build_prompt(question: str, facts: list[Fact], language: Language, intent: str | None = None) -> str:
    lang = "English" if language == "en" else "Hindi (Devanagari)"
    head = f"Language: {lang}\nQuestion: {question.strip()}\n"
    if intent:
        head += f"What the app thinks the question is about: {intent}\n"
    return head + "\nFACTS:\n" + _facts_block(facts, language) + "\n\nWrite the answer now."


class Writer(Protocol):
    name: str

    def write(self, system: str, prompt: str) -> str: ...


class ClaudeWriter:
    """The Anthropic Messages API behind one short, cached system prompt."""

    name = MODEL

    def __init__(self, api_key: str) -> None:
        import anthropic

        self._anthropic = anthropic
        self.client = anthropic.Anthropic(api_key=api_key, max_retries=2, timeout=40.0)

    def write(self, system: str, prompt: str) -> str:
        a = self._anthropic
        try:
            response = self.client.beta.messages.create(
                model=MODEL,
                max_tokens=600,
                output_config={"effort": "low"},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": prompt}],
            )
        except a.RateLimitError as e:
            raise HTTPException(429, "the writer is busy; try again in a minute") from e
        except a.AuthenticationError as e:
            raise HTTPException(503, "writer key rejected") from e
        except a.APIStatusError as e:
            raise HTTPException(502, f"writer error {e.status_code}") from e
        except a.APIConnectionError as e:
            raise HTTPException(502, "writer unreachable") from e
        if response.stop_reason == "refusal":
            raise HTTPException(422, "the writer declined this question")
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        if not text:
            raise HTTPException(502, "writer returned nothing")
        return text


class EchoWriter:
    """Deterministic stand-in for tests and fixture runs: repeats the facts in plain words."""

    name = "echo-writer"

    def write(self, system: str, prompt: str) -> str:  # noqa: ARG002
        facts = [ln.split("] ", 1)[1] for ln in prompt.splitlines() if ln[:1].isdigit() and "] " in ln]
        if not facts:
            return "The map has no facts for this question right now."
        return " ".join(f.rstrip(".") + "." for f in facts[:4])


def make_writer(fake: bool = False) -> Writer | None:
    if fake:
        return EchoWriter()
    if settings.anthropic_api_key:
        return ClaudeWriter(settings.anthropic_api_key)
    return None


def register(app: FastAPI, writer: Writer | None = None, fake: bool = False) -> None:
    w = writer or make_writer(fake)
    app.state.writer = w

    def need() -> Writer:
        if w is None:
            raise HTTPException(503, "writer not configured: set ANTHROPIC_API_KEY")
        return w

    @app.post("/api/explain", response_model=WriterReply)
    def explain(req: ExplainRequest) -> WriterReply:
        if not req.evidence:
            raise HTTPException(400, "no evidence: the writer only rewrites measured facts")
        text = need().write(SYSTEM, build_prompt(req.question, req.evidence, req.language, req.intent))
        return WriterReply(text=text, writer=need().name, language=req.language)

    @app.post("/api/ask", response_model=WriterReply)
    def ask(req: AskRequest) -> WriterReply:
        text = need().write(SYSTEM_ASK, build_prompt(req.question, req.snapshot, req.language))
        return WriterReply(text=text, writer=need().name, language=req.language)

    @app.get("/api/writer/status")
    def status() -> dict[str, Any]:
        return {"configured": w is not None, "writer": w.name if w else None, "model": MODEL, "languages": ["en", "hi"]}
