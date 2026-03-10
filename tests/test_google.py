"""
Basic Playwright Python tests — navigating to Google.com.

These are intentionally simple so the pipeline is easy to verify
and swap out for your own test suite.

Run locally:
    # single browser (fast)
    pytest tests/ --browser chromium -v

    # all browsers
    pytest tests/ --browser chromium --browser firefox --browser webkit -v
"""

import re
import pytest
from playwright.sync_api import Page, expect


# ── Test 1 : page title ──────────────────────────────────────────────────────

def test_google_homepage_title(page: Page) -> None:
    """Google homepage should have 'Google' in the page title."""
    page.goto("https://www.google.com")
    expect(page).to_have_title(re.compile("Google"))


# ── Test 2 : search input is visible ────────────────────────────────────────

def test_google_search_input_visible(page: Page) -> None:
    """The main search textarea should be visible immediately."""
    page.goto("https://www.google.com")
    search_input = page.locator('textarea[name="q"]')
    expect(search_input).to_be_visible()


# ── Test 3 : typing in the search box ───────────────────────────────────────

def test_google_search_input_accepts_text(page: Page) -> None:
    """Typing into the search box should update its value."""
    page.goto("https://www.google.com")
    search_input = page.locator('textarea[name="q"]')
    search_input.fill("Playwright Python")
    expect(search_input).to_have_value("Playwright Python")


# ── Test 4 : search navigates to results page ────────────────────────────────

def test_google_search_navigates_to_results(page: Page) -> None:
    """Pressing Enter after a search should load a results URL."""
    page.goto("https://www.google.com")
    page.locator('textarea[name="q"]').fill("Playwright Python")
    page.keyboard.press("Enter")
    # Google redirects to /search?q=...  — verify we land on a search URL
    page.wait_for_url(re.compile(r"/search"))
    expect(page).to_have_url(re.compile(r"/search"))
