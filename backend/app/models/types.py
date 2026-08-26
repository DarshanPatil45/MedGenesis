"""Shared column types.

`JSONColumn` is SQLAlchemy's generic JSON type, which SQLite stores as TEXT
and transparently serialises/deserialises to Python dicts and lists. It is
aliased here rather than imported directly in each model so there is a single
place to change if the project ever moves to another database.
"""

from sqlalchemy import JSON

JSONColumn = JSON
