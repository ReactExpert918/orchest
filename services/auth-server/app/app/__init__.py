"""Use the Flask application factory pattern.

Additinal note:
    `pytest` requires this __init__.py file to be present for version of
    Python below and including version 3.2.

        https://docs.pytest.org/en/latest/goodpractices.html
"""
from flask import Flask
from flask_migrate import Migrate, upgrade
from sqlalchemy_utils import create_database, database_exists

from app.views import register_views
from app.connections import db


def create_app(config_class=None):
    app = Flask(__name__)
    app.config.from_object(config_class)

    # Create the database if it does not exist yet. Roughly equal to
    # a "CREATE DATABASE IF NOT EXISTS <db_name>" call.
    if not database_exists(app.config["SQLALCHEMY_DATABASE_URI"]):
        create_database(app.config["SQLALCHEMY_DATABASE_URI"])

    db.init_app(app)
    # necessary for migration
    Migrate().init_app(app, db)

    with app.app_context():
        # Upgrade to the latest revision. This also takes care of
        # bringing an "empty" db (no tables) on par.
        upgrade()

    register_views(app)

    return app
