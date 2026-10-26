"""Firm Wind API (Vercel entrypoint `main:app`): thin routes over `app.service` views."""

import csv
import io
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from datetime import time as clock
from typing import Annotated

from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from app import __version__, data, service
from app import analysis as A
from app.schemas import (
    Accuracy,
    Calib,
    ErrorBody,
    ErrorDetail,
    ExportView,
    Firm,
    Health,
    Live,
    Meta,
    Replay,
    SourceStatus,
    Waiting,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("firmwind.api")

Cutoff = Annotated[
    str,
    Query(
        pattern=r"^(epex|n2ex|([01]\d|2[0-3]):[0-5]\d)$",
        description="Auction preset or a custom D-1 time in Europe/London (HH:MM).",
    ),
]
# Query strings arrive as text, and a Literal of ints rejects "10", so the margin is a validated int.
# 60 min is the sensitivity case: runs only usable at the times Elexon documents, an hour after publishTime.
Margin = Annotated[
    int, Query(ge=0, le=60, multiple_of=10, description="Data-latency margin, minutes (0-60, steps of 10).")
]
CalibQ = Annotated[Calib, Query(description="Training window start: January only, or from 1 December.")]
DayQ = Annotated[date, Query(description="Delivery day; one of meta.days.")]
CacheBust = Annotated[str | None, Query(description="Data hash sent by the client; ignored by the server.")]

ERRORS = {422: {"model": ErrorBody}}


class ParamError(ValueError):
    """A query parameter that passed type validation but is not allowed (e.g. a day outside the pilot)."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


# Browsers revalidate after 5 min; the Vercel CDN keeps a day and serves stale for a week while it
# refreshes. January views are a pure function of the snapshot, and the client busts with ?v=<hash>.
STATIC = {
    "Cache-Control": "public, max-age=300",
    "Vercel-CDN-Cache-Control": "s-maxage=86400, stale-while-revalidate=604800",
}
META_TTL = {"checking": 30, "verified": 300, "changed": 300, "unreachable": 60}


def _short(seconds: int) -> dict[str, str]:
    """Status-dependent payloads: the browser always asks again, the CDN absorbs the polling."""
    return {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Vercel-CDN-Cache-Control": f"s-maxage={seconds}",
    }


def _error(code: str, message: str, field: str | None = None) -> JSONResponse:
    body = ErrorBody(error=ErrorDetail(code=code, message=message, field=field))
    return JSONResponse(status_code=422, content=body.model_dump(mode="json"))


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    data.start_verify()
    yield


app = FastAPI(
    title="Firm Wind API",
    version=__version__,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0]
    field = ".".join(str(p) for p in first["loc"] if p not in ("query", "path", "body")) or None
    return _error("invalid_param", first["msg"], field)


# Only ParamError: any other exception is a server bug and must surface as a logged 500, not a 422.
@app.exception_handler(ParamError)
async def _param_error(_: Request, exc: ParamError) -> JSONResponse:
    return _error("invalid_param", str(exc), exc.field)


@app.middleware("http")
async def _log_requests(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    start = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - start) * 1000
    log.info(
        "%s %s %d %.0fms source=%s",
        request.method,
        request.url.path,
        response.status_code,
        ms,
        data.source_status()["state"],
    )
    return response


api = APIRouter(prefix="/api/v1", responses=ERRORS)


@api.get("/meta", response_model=Meta)
def meta(response: Response) -> Meta:
    m = service.meta_view()
    response.headers.update(_short(META_TTL[m.source.state]))
    return m


@api.get("/source", response_model=SourceStatus)
def source(response: Response) -> SourceStatus:
    """Snapshot check against live Elexon. Runs inline when no recent result exists (~5 s)."""
    st = SourceStatus(**data.verify_once())
    response.headers.update(_short(3600 if st.state in ("verified", "changed") else 60))
    return st


@api.get("/replay", response_model=Replay)
def replay(
    response: Response,
    day: DayQ,
    cutoff: Cutoff = "epex",
    margin: Margin = 0,
    calib: CalibQ = "jan",
    v: CacheBust = None,
) -> Replay:
    _check_day(day)
    response.headers.update(STATIC)
    return service.replay_view(day, cutoff, margin, calib)


@api.get("/accuracy", response_model=Accuracy)
def accuracy(
    response: Response,
    cutoff: Cutoff = "epex",
    margin: Margin = 0,
    calib: CalibQ = "jan",
    v: CacheBust = None,
) -> Accuracy:
    response.headers.update(STATIC)
    return service.accuracy_view(cutoff, margin, calib)


@api.get("/firm", response_model=Firm)
def firm(
    response: Response,
    cutoff: Cutoff = "epex",
    margin: Margin = 0,
    calib: CalibQ = "jan",
    v: CacheBust = None,
) -> Firm:
    response.headers.update(STATIC)
    return service.firm_view(cutoff, margin, calib)


@api.get("/waiting", response_model=Waiting)
def waiting(response: Response, v: CacheBust = None) -> Waiting:
    response.headers.update(STATIC)
    return service.waiting_view()


@api.get("/live", response_model=Live)
def live(response: Response, cutoff: Cutoff = "epex", margin: Margin = 0) -> Live:
    """Always 200: an Elexon outage is a `status`, not an HTTP error, so the page can say so."""
    now = datetime.now(UTC)
    out = service.live_view(cutoff, margin, now)
    response.headers.update(_short(_live_ttl(out, now)))
    return out


@api.get("/export.csv", response_class=Response, responses={200: {"content": {"text/csv": {}}}})
def export_csv(
    view: Annotated[ExportView, Query()],
    cutoff: Cutoff = "epex",
    margin: Margin = 0,
    calib: CalibQ = "jan",
    day: Annotated[date | None, Query(description="Required for view=replay.")] = None,
    v: CacheBust = None,
) -> Response:
    if view == "replay":
        if day is None:
            raise ParamError("day", "required for view=replay")
        _check_day(day)
    receipt, header, rows = service.export_rows(view, cutoff, margin, calib, day)
    buf = io.StringIO()
    buf.write("\n".join(receipt) + "\n")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    # MW are whole numbers carried as floats; write 2039, not 2039.0.
    w.writerows([int(x) if isinstance(x, float) and x.is_integer() else x for x in row] for row in rows)
    name = f"firmwind-{view}-{day or cutoff}.csv".replace(":", "")
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={**STATIC, "Content-Disposition": f'attachment; filename="{name}"'},
    )


@api.get("/health", response_model=Health)
def health(response: Response) -> Health:
    response.headers["Cache-Control"] = "no-store"
    snap = data.load_snapshot()
    return Health(
        ok=True, version=__version__, data_hash=snap.hash, source=SourceStatus(**data.source_status())
    )


def _live_ttl(out: Live, now: datetime) -> int:
    """CDN lifetime of a live answer: until it can next change, i.e. the gate (gate_passed and the run
    used), London midnight (a new "tomorrow") or the data cache expiring, capped at 30 min."""
    if out.status != "ok":
        return 60
    ends = [A.local_utc(out.target_day, clock(0)).to_pydatetime()]
    if not out.gate_passed:
        ends.append(out.cutoff_utc)
    if out.fetched_at:
        ends.append(out.fetched_at + timedelta(seconds=data.LIVE_TTL_S))
    return max(1, min(1800, int(min(e - now for e in ends).total_seconds())))


def _check_day(day: date) -> None:
    if day not in A.DAYS:
        raise ParamError("day", f"{day} is outside the January pilot")


app.include_router(api)
