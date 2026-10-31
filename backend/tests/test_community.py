"""Community: members-only stamps (photo + caption), likes, top post of the week, moderation."""

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.models import Post

from .conftest import AuthClient
from .test_admin import _log_in, _make_admin
from .test_experiences import NOTE
from .test_photos import Checker, _files, _jpeg, _settings, _upload, checker  # noqa: F401

ADA, TOLU, BOSS = "ada_demo@example.com", "tolu_demo@example.com", "boss_demo@example.com"


def _post(client: AuthClient, caption: str = "Our first trip 🌴") -> Any:
    photo = _upload(client, _jpeg()).json()["id"]
    return client.post("/community/posts", json={"photo_id": photo, "caption": caption})


def _age(client: AuthClient, post_id: str, days: int) -> None:
    settings = _settings(client)

    async def run() -> None:
        engine = create_async_engine(settings.database_url.get_secret_value(), poolclass=NullPool)
        async with async_sessionmaker(engine)() as db:
            when = datetime.now(UTC) - timedelta(days=days)
            await db.execute(update(Post).where(Post.id == post_id).values(created_at=when))
            await db.commit()
        await engine.dispose()

    asyncio.run(run())


@pytest.fixture
def two(auth_client: AuthClient, checker: Checker) -> AuthClient:  # noqa: F811
    auth_client.sign_up(TOLU, "tolu_demo")
    auth_client.cookies.clear()
    auth_client.use_csrf()
    auth_client.sign_up(ADA, "ada_demo")
    return auth_client


def test_members_only(auth_client: AuthClient) -> None:
    assert auth_client.get("/community/feed").status_code == 401
    assert auth_client.get("/community/top").status_code == 401


def test_post_like_and_see_it(two: AuthClient) -> None:
    created = _post(two)
    assert created.status_code == 201, created.text
    post = created.json()
    assert post["mine"] and post["photo"]["small_url"] and post["author"]["username"] == "ada_demo"

    _log_in(two, TOLU)
    [seen] = two.get("/community/feed").json()["items"]
    assert seen["caption"] == "Our first trip 🌴" and not seen["mine"] and not seen["liked"]
    for _ in range(2):  # liking twice counts once
        assert two.post(f"/community/posts/{post['id']}/like").json() == {
            "like_count": 1,
            "liked": True,
        }
    assert two.delete(f"/community/posts/{post['id']}/like").json()["like_count"] == 0
    two.post(f"/community/posts/{post['id']}/like")
    assert two.get("/community/feed").json()["items"][0]["liked"] is True
    # Only the author can delete it.
    assert two.delete(f"/community/posts/{post['id']}").status_code == 404


def test_bad_posts_are_refused(two: AuthClient) -> None:
    assert _post(two, "see www.example.com").status_code == 400
    assert _post(two, "   ").status_code == 400
    photo = _upload(two, _jpeg()).json()["id"]
    assert (
        two.post("/community/posts", json={"photo_id": photo, "caption": "One"}).status_code == 201
    )
    # The same photo can't go on a second post, or on a letter.
    assert (
        two.post("/community/posts", json={"photo_id": photo, "caption": "Two"}).status_code == 400
    )
    letter = two.post("/experiences", json={**NOTE, "content": {**NOTE["content"], "photo": photo}})
    assert letter.status_code == 400
    _log_in(two, TOLU)
    stolen = _upload(two, _jpeg()).json()["id"]
    _log_in(two, ADA)
    assert (
        two.post("/community/posts", json={"photo_id": stolen, "caption": "Mine?"}).status_code
        == 400
    )


def test_top_post_of_the_week(two: AuthClient, monkeypatch: pytest.MonkeyPatch) -> None:
    assert two.get("/community/top").json() == {"post": None, "picked": False}
    quiet = _post(two, "Quiet one").json()
    loved = _post(two, "Loved one").json()
    old = _post(two, "Last month").json()
    _log_in(two, TOLU)
    for post in (loved, old):
        two.post(f"/community/posts/{post['id']}/like")
    two.post(f"/community/posts/{quiet['id']}/like")
    two.delete(f"/community/posts/{quiet['id']}/like")
    _age(two, old["id"], days=8)  # outside the last 7 days
    top = two.get("/community/top").json()
    assert top["post"]["id"] == loved["id"] and top["picked"] is False

    # An admin can choose another post for this week, then go back to likes.
    two.cookies.clear()
    two.use_csrf()
    two.sign_up(BOSS, "boss_demo")
    _make_admin(two, monkeypatch, BOSS)
    _log_in(two, BOSS)
    assert two.post("/admin/top", json={"post_id": quiet["id"]}).status_code == 204
    top = two.get("/community/top").json()
    assert top["post"]["id"] == quiet["id"] and top["picked"] is True
    admin_view = two.get("/admin/posts").json()
    assert admin_view["top_picked"] is True
    assert [p["top"] for p in admin_view["items"] if p["id"] == quiet["id"]] == [True]
    assert two.post("/admin/top", json={"post_id": None}).status_code == 204
    assert two.get("/community/top").json()["post"]["id"] == loved["id"]
    # A removed post is never top.
    assert (
        two.post(f"/admin/posts/{loved['id']}/removed", json={"removed": True}).status_code == 204
    )
    assert two.get("/community/top").json()["post"] is None
    assert [p["id"] for p in two.get("/admin/posts?show=removed").json()["items"]] == [loved["id"]]


def test_report_then_take_down(two: AuthClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api import community

    emailed: list[Any] = []

    async def capture(_http: object, _settings: object, email: Any) -> None:
        emailed.append(email)

    monkeypatch.setattr(community, "send_email", capture)
    post = _post(two).json()
    _log_in(two, TOLU)
    assert (
        two.post(f"/community/posts/{post['id']}/report", json={"reason": "nope"}).status_code
        == 400
    )
    assert (
        two.post(
            f"/community/posts/{post['id']}/report",
            json={"reason": "spam", "note": "Selling things"},
        ).status_code
        == 204
    )
    [email] = emailed
    assert email.subject == "Dearlly report (community): spam"
    assert "@ada_demo" in email.text and "/admin" in email.text

    two.cookies.clear()
    two.use_csrf()
    two.sign_up(BOSS, "boss_demo")
    _make_admin(two, monkeypatch, BOSS)
    _log_in(two, BOSS)
    [report] = two.get("/admin/reports").json()
    assert report["post"]["caption"] == "Our first trip 🌴" and report["sender"] == "@ada_demo"
    assert report["post"]["photo"]["small_url"]
    assert two.post(f"/admin/reports/{report['id']}/takedown").status_code == 204
    assert two.get("/community/feed").json()["items"] == []
    assert two.get("/admin/reports").json() == []


def test_deleting_a_post_deletes_its_photo(two: AuthClient, tmp_path: Path) -> None:
    post = _post(two).json()
    assert len(_files(tmp_path)) == 2  # full and phone copies
    assert two.delete(f"/community/posts/{post['id']}").status_code == 204
    assert _files(tmp_path) == []
    assert two.get("/community/feed").json()["items"] == []


def test_the_feed_comes_twenty_at_a_time(two: AuthClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api import community

    monkeypatch.setattr(community, "PAGE", 2)
    for n in range(3):
        _post(two, f"Post {n}")
    first = two.get("/community/feed").json()
    assert [p["caption"] for p in first["items"]] == ["Post 2", "Post 1"]
    rest = two.get("/community/feed", params={"before": first["next_before"]}).json()
    assert [p["caption"] for p in rest["items"]] == ["Post 0"] and rest["next_before"] is None
