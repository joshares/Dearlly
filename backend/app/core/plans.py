"""Plans and server-side feature checks.

Everything is free at launch. Paid features (see "Money plan" in docs/build-plan.md) are switched on
later by changing PLAN_FEATURES, never by trusting the browser. Accounts get a `plan` column through
PlanMixin when the users table arrives in Stage 2.
"""

from enum import StrEnum

from fastapi import HTTPException, status
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column


class Plan(StrEnum):
    FREE = "free"
    PREMIUM = "premium"


class Feature(StrEnum):
    SCHEDULED_SEND = "scheduled_send"
    PREMIUM_THEMES = "premium_themes"
    MUSIC = "music"
    NO_WATERMARK = "no_watermark"
    HD_DOWNLOAD = "hd_download"
    SPECIAL_REVEALS = "special_reveals"
    GAME_PACKS = "game_packs"


# Scheduled send is free at launch ("Features at launch"); the rest are premium ideas for later.
PLAN_FEATURES: dict[Plan, frozenset[Feature]] = {
    Plan.FREE: frozenset({Feature.SCHEDULED_SEND}),
    Plan.PREMIUM: frozenset(Feature),
}


def has_feature(plan: Plan, feature: Feature) -> bool:
    return feature in PLAN_FEATURES[plan]


def require_feature(plan: Plan, feature: Feature) -> None:
    if not has_feature(plan, feature):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This feature is not included in your plan.",
        )


class PlanMixin:
    plan: Mapped[Plan] = mapped_column(
        SAEnum(Plan, native_enum=False, length=20, values_callable=lambda e: [m.value for m in e]),
        default=Plan.FREE,
        server_default=Plan.FREE.value,
        nullable=False,
    )
