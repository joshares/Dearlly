"""Founder tools, run on the server. Take down a reported letter (its link stops working):

ssh -t dearlly docker exec dearlly-api-1 python -m app.admin takedown <letter id>
"""

import asyncio
import sys
import uuid
from datetime import UTC, datetime

from app.core.config import get_settings
from app.db.session import create_engine, create_sessionmaker
from app.models import Experience
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
            await db.commit()
            return "Taken down: its link now shows 'No letter here'."
    finally:
        await engine.dispose()


def main(argv: list[str]) -> int:
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
