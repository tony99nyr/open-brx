"""Maintainability review 2026-10-03, operator lane: failures MC used to swallow (O4, O5, O11, O14)."""
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def test_o4_log_lines_carry_a_millisecond_timestamp():
    from brx_mcp.mc.__main__ import LOG_DATEFMT, LOG_FORMAT
    rec = logging.LogRecord("brx_mcp.mc.x", logging.INFO, __file__, 1, "hello %s", ("world",), None)
    line = logging.Formatter(LOG_FORMAT, LOG_DATEFMT).format(rec)
    assert re.match(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} INFO brx_mcp\.mc\.x: hello world$", line), line


def test_o4_report_scrub_keeps_the_timestamp():
    from brx_mcp.mc.report import Aliaser, scrub_text
    line = "2026-10-04 12:34:56.789 INFO brx_mcp.mc.net: node up"
    out = scrub_text(Aliaser(), line)
    assert out.startswith("2026-10-04 12:34:56.789 INFO"), out
