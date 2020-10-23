from app.connections import db
from sqlalchemy import UniqueConstraint
import datetime
import uuid


def str_uuid4():
    return str(uuid.uuid4())


class Project(db.Model):
    __tablename__ = 'project'

    uuid = db.Column(db.String(255), nullable=False, primary_key=True)
    path = db.Column(db.String(255), nullable=False)

    __table_args__ = (UniqueConstraint('uuid', 'path'),)


class Pipeline(db.Model):
    __tablename__ = 'pipeline'

    uuid = db.Column(db.String(255), nullable=False)
    path = db.Column(db.String(255), nullable=False)
    project_uuid = db.Column(db.ForeignKey("project.uuid"))
    
    __table_args__ = (UniqueConstraint('uuid', 'path', 'project_uuid'),)


class DataSource(db.Model):
    __tablename__ = 'datasources'

    name = db.Column(db.String(255), unique=True, nullable=False, primary_key=True)
    source_type = db.Column(db.String(100), nullable=False)
    connection_details = db.Column(db.JSON, nullable=False)
    created = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)

    def __repr__(self):
        return f'<DataSource {self.name}:{self.source_type}>'


class Image(db.Model):
    __tablename__ = 'images'
    
    uuid = db.Column(db.String(255), unique=True, nullable=False, default=str_uuid4, primary_key=True)
    name = db.Column(db.String(255), unique=True, nullable=False)
    language = db.Column(db.String(255), nullable=False)
    created = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)
    gpu_support = db.Column(db.Boolean, default=False)

    def __repr__(self):
        return f'<Images {self.name}:{self.language}>'


class Commit(db.Model):
    __tablename__ = 'commits'
    
    uuid = db.Column(db.String(255), unique=True, nullable=False, primary_key=True)
    tag = db.Column(db.String(255), unique=False, nullable=False)
    name = db.Column(db.String(255), unique=False, nullable=False)
    base_image = db.Column(db.ForeignKey("images.name"))
    project = db.Column(db.String(255), unique=False, nullable=False)
    created = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)
    building = db.Column(db.Boolean, default=False)

    def __repr__(self):
        return f'<Commit {self.name}:{self.base_image}:{self.uuid}>'


class Experiment(db.Model):
    __tablename__ = 'experiments'

    name = db.Column(db.String(255), unique=False, nullable=False)
    uuid = db.Column(db.String(255), unique=True, nullable=False, primary_key=True)
    pipeline_uuid = db.Column(db.String(255), unique=False, nullable=False)
    project_uuid = db.Column(db.String(255), unique=False, nullable=False)
    pipeline_name = db.Column(db.String(255), unique=False, nullable=False)
    created = db.Column(db.DateTime, nullable=False, default=datetime.datetime.utcnow)
    strategy_json = db.Column(db.Text, nullable=False)
    draft = db.Column(db.Boolean())


class PipelineRun(db.Model):
    __tablename__ = 'pipelineruns'

    uuid = db.Column(db.String(255), unique=True, nullable=False, primary_key=True)
    id = db.Column(db.Integer(), unique=False)
    experiment = db.Column(db.ForeignKey("experiments.uuid"))
    parameter_json = db.Column(db.JSON, nullable=False)