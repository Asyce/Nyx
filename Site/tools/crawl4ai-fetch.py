#!/usr/bin/env python3
"""Fetch a page with Crawl4AI when available, otherwise fall back to urllib.

The JavaScript scrapers call this helper only when NYX_USE_CRAWL4AI=1. Keeping
the fallback here lets the same script run on GitHub Actions, a VPS, and local
machines that have not installed Crawl4AI yet.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import urllib.error
import urllib.request


DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0 Safari/537.36"
)


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=True))


def urllib_fetch(url: str, timeout: float, user_agent: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
            encoding = response.headers.get_content_charset() or "utf-8"
            return {
                "success": True,
                "source": "urllib",
                "url": response.geturl(),
                "status_code": response.status,
                "html": body.decode(encoding, errors="replace"),
            }
    except urllib.error.HTTPError as exc:
        body = exc.read()
        encoding = exc.headers.get_content_charset() or "utf-8"
        return {
            "success": False,
            "source": "urllib",
            "url": url,
            "status_code": exc.code,
            "html": body.decode(encoding, errors="replace"),
            "error": str(exc),
        }
    except Exception as exc:  # noqa: BLE001 - report the exact transport failure.
        return {
            "success": False,
            "source": "urllib",
            "url": url,
            "status_code": None,
            "html": "",
            "error": str(exc),
        }


async def crawl4ai_fetch(args: argparse.Namespace) -> dict:
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
    except Exception as exc:  # noqa: BLE001 - package is optional.
        fallback = urllib_fetch(args.url, args.timeout, args.user_agent)
        fallback["crawl4ai_error"] = f"Crawl4AI unavailable: {exc}"
        return fallback

    browser_config = BrowserConfig(headless=True, verbose=False)
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        js_code=args.js_code or None,
        wait_for=args.wait_for or None,
        page_timeout=int(args.timeout * 1000),
    )

    try:
        async with AsyncWebCrawler(config=browser_config) as crawler:
            result = await crawler.arun(url=args.url, config=run_config)
    except Exception as exc:  # noqa: BLE001 - callers need the raw failure detail.
        fallback = urllib_fetch(args.url, args.timeout, args.user_agent)
        fallback["crawl4ai_error"] = str(exc)
        return fallback

    html = getattr(result, "html", "") or ""
    markdown = getattr(result, "markdown", None)
    status_code = getattr(result, "status_code", None)
    final_url = getattr(result, "url", args.url) or args.url
    success = bool(getattr(result, "success", bool(html)))

    return {
        "success": success,
        "source": "crawl4ai",
        "url": final_url,
        "status_code": status_code,
        "html": html,
        "markdown": markdown,
        "error": getattr(result, "error_message", None),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    parser.add_argument("--js-code", default="")
    parser.add_argument("--wait-for", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        payload = asyncio.run(crawl4ai_fetch(args))
    except Exception as exc:  # noqa: BLE001 - final guard so Node gets JSON.
        payload = {
            "success": False,
            "source": "crawl4ai-helper",
            "url": args.url,
            "status_code": None,
            "html": "",
            "error": str(exc),
        }
    emit(payload)
    return 0 if payload.get("html") else 1


if __name__ == "__main__":
    raise SystemExit(main())
