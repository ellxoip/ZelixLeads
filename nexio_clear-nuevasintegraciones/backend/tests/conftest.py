"""
Shared fixtures for NEXIO backend tests.
Uses SQLite in-memory DB — never touches production PostgreSQL.
"""
import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Point to in-memory SQLite so tests are isolated from prod DB
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["SECRET_KEY"] = "test-secret-key-not-for-production"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"  # won't be used in unit tests

from app.database import Base, get_db

# ── Engine & session factory for tests ────────────────────────────────────────
# StaticPool: a single shared in-memory connection — without it each new
# connection gets its own empty :memory: database and tables "disappear".
engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Override the database module variables so that direct imports/usages also use the testing DB
import app.database as app_db
app_db.engine = engine
app_db.SessionLocal = TestingSessionLocal

from app.main import app
from app import models
from app.auth import hash_password


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def create_tables():
    """Recreate all tables per test — isolation via fresh schema."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db():
    """Fresh DB session per test (tables are dropped after each test)."""
    session = TestingSessionLocal()
    yield session
    session.close()


@pytest.fixture()
def client():
    """TestClient with in-memory DB override."""
    return TestClient(app)


# ── Seed data fixtures ─────────────────────────────────────────────────────────

@pytest.fixture()
def test_group(db):
    """Creates a test negocio group."""
    group = models.Group(
        name="Test Negocio",
        description="Group for tests",
        tipo="abogados",
        plan="basico",
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@pytest.fixture()
def test_superadmin(db, test_group):
    """Creates a superadmin user."""
    user = models.User(
        name="Admin Test",
        email="admin@test.com",
        password_hash=hash_password("Test1234"),
        role="superadmin",
        group_id=test_group.id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def test_agendadora(db, test_group):
    """Creates an agendadora user."""
    user = models.User(
        name="Agenda Test",
        email="agenda@test.com",
        password_hash=hash_password("Test1234"),
        role="agendadora",
        group_id=test_group.id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def auth_headers_admin(client, db, test_superadmin):
    """Returns Authorization headers for superadmin user."""
    resp = client.post("/api/auth/login", json={
        "email": "admin@test.com",
        "password": "Test1234",
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def auth_headers_agendadora(client, db, test_agendadora):
    """Returns Authorization headers for agendadora user."""
    resp = client.post("/api/auth/login", json={
        "email": "agenda@test.com",
        "password": "Test1234",
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def test_vendedor(db, test_group):
    """Creates a vendedor user."""
    user = models.User(
        name="Vendedor Test",
        email="vendedor@test.com",
        password_hash=hash_password("Test1234"),
        role="vendedor",
        group_id=test_group.id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def test_contact(db, test_group, test_superadmin):
    """Creates a test contact."""
    contact = models.Contact(
        name="Juan Pérez Test",
        phone="+56912345678",
        email="juan@test.com",
        group_id=test_group.id,
        created_by=test_superadmin.id,
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@pytest.fixture()
def test_area(db, test_group):
    """Creates a test legal area."""
    area = models.Area(
        name="Prescripción",
        group_id=test_group.id,
    )
    db.add(area)
    db.commit()
    db.refresh(area)
    return area


@pytest.fixture()
def test_lead(db, test_contact, test_area, test_superadmin, test_agendadora, test_vendedor, test_group):
    """Creates a test lead in 'lead' stage."""
    lead = models.Lead(
        contact_id=test_contact.id,
        area_id=test_area.id,
        current_stage="lead",
        agendadora_id=test_agendadora.id,
        vendedor_id=test_vendedor.id,
        group_id=test_group.id,
        honorarios=500000,
        cuota_inicial=100000,
        num_cuotas=4,
        monto_cuota=100000,
        source="whatsapp",
        priority="normal",
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead
