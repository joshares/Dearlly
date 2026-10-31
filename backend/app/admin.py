"""Founder tools, run on the server (from the Mac):

  ssh -t dearlly docker exec dearlly-api-1 python -m app.admin make-admin <email>
  ssh -t dearlly docker exec dearlly-api-1 python -m app.admin remove-admin <email>
  ssh -t dearlly docker exec dearlly-api-1 python -m app.admin takedown <letter id>

make-admin: lets that account open dearlly.app/admin (it must already have signed up).
takedown: a reported letter's link stops working (the admin page can do this too).
"""

import asyncio
import sys
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update

from app.core.config import get_settings
from app.db.session import create_engine, create_sessionmaker
from app.models import Experience, Report, User
from app.services.letter_mail import forget_address


async def takedown(letter_id: uuid.UUID) -> str:
    engine = create_engine(get_settings())
    try:
        async with create_sessionmaker(engine)() as db:
            letter = await db.get(Experience, letter_id)
            if letter is None:
                return "No letter with that id (it may already be deleted)."
            if letter.revoked_at is None:
                letter.revoked_at = datetime.now(UTC)
            if letter.email_status == "scheduled":
                forget_address(letter, "cancelled")
            await db.execute(
                update(Report)
                .where(Report.experience_id == letter_id, Report.status == "open")
                .values(status="resolved", resolution="taken_down", resolved_at=datetime.now(UTC))
            )
            await db.commit()
            return "Taken down: its link now shows 'No letter here'."
    finally:
        await engine.dispose()


async def set_admin(email: str, on: bool) -> str:
    engine = create_engine(get_settings())
    try:
        async with create_sessionmaker(engine)() as db:
            user = (
                await db.execute(select(User).where(User.email == email.strip().lower()))
            ).scalar_one_or_none()
            if user is None:
                return "No account with that email. Sign up on dearlly.app first, then run this."
            user.is_admin = on
            await db.commit()
            if on:
                return (
                    f"@{user.username} is now an admin: dearlly.app/admin (log in again if open)."
                )
            return f"@{user.username} is no longer an admin."
    finally:
        await engine.dispose()


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] in ("make-admin", "remove-admin"):
        if "@" not in argv[1]:
            print("That doesn't look like an email address.")
            return 2
        print(asyncio.run(set_admin(argv[1], argv[0] == "make-admin")))
        return 0
    if len(argv) != 2 or argv[0] != "takedown":
        print(__doc__)
        return 2
    try:
        letter_id = uuid.UUID(argv[1])
    except ValueError:
        print("That isn't a letter id. Copy the 'Letter:' line from the report email.")
        return 2
    print(asyncio.run(takedown(letter_id)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
