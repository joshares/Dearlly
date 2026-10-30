"""Public list of curated date places, for the date invitation form and (later) the planner."""

from datetime import date

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.services import places as catalogue

router = APIRouter(tags=["places"])


class CityOut(BaseModel):
    key: str
    name: str
    place_count: int


class SourceOut(BaseModel):
    publisher: str
    title: str
    url: str
    published: date | None
    rank: int | None


class PlaceOut(BaseModel):
    key: str
    name: str
    area: str
    address: str | None
    kind: str
    vibes: list[str]
    price: int | None
    price_note: str | None
    sources: list[SourceOut]


@router.get("/cities")
async def list_cities() -> list[CityOut]:
    return [
        CityOut(key=c.key, name=c.name, place_count=len(c.places))
        for c in catalogue.cities().values()
    ]


@router.get("/cities/{city}/places")
async def list_places(city: str, vibe: str | None = None) -> list[PlaceOut]:
    found = catalogue.cities().get(city)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "We don't cover that city yet.")
    chosen = [p for p in found.places if vibe is None or vibe in p.vibes]
    return [
        PlaceOut(
            key=p.key,
            name=p.name,
            area=p.area,
            address=p.address,
            kind=p.kind,
            vibes=list(p.vibes),
            price=p.price,
            price_note=p.price_note,
            sources=[
                SourceOut(
                    publisher=found.sources[m.source].publisher,
                    title=found.sources[m.source].title,
                    url=str(found.sources[m.source].url),
                    published=found.sources[m.source].published,
                    rank=m.rank,
                )
                for m in p.sources
            ],
        )
        for p in catalogue.ordered(chosen)
    ]
