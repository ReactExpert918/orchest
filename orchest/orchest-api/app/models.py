from app.connections import db


class BaseModel:
    def as_dict(self):
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}


class Launch(BaseModel, db.Model):
    __tablename__ = 'launches'
    pipeline_uuid = db.Column(db.String(36), primary_key=True)
    server_ip = db.Column(db.String(15), unique=True, nullable=False)  # IPv4
    server_info = db.Column(db.JSON, unique=True, nullable=False)

    def __repr__(self):
        return f'<Launch {self.pipeline_uuid}>'


class Run(BaseModel, db.Model):
    __tablename__ = 'runs'
    run_uid = db.Column(db.String(36), primary_key=True)
    pipeline_uuid = db.Column(db.String(36), unique=False, nullable=False)
    status = db.Column(db.String(15), unique=False, nullable=True)
    step_statuses = db.relationship('StepStatus', lazy='select')

    def __repr__(self):
        return f'<Run {self.run_uid}>'


class StepStatus(BaseModel, db.Model):
    __tablename__ = 'stepstatus'
    run_uid = db.Column(db.String(36), db.ForeignKey('runs.run_uid'), primary_key=True)
    step_uuid = db.Column(db.String(36), primary_key=True)
    status = db.Column(db.String(15), unique=False, nullable=True)

    def __repr__(self):
        return f'<StepStatus {self.run_uid}.{self.step_uuid}>'
